// ==========================================================================
// post.js — コラムを書くページ（post.html）の動き
//
// やることは 3 つ。
//   1. 書いた文章の下見を出す（/api/preview。公開される見た目と同じものが返る）
//   2. 画像を上げて、本文のカーソル位置に Markdown として入れる（/api/images）
//   3. 投稿する（/api/columns。承認待ちで保存される）
//
// 通常の <script> はグローバルを共有するので、名前は外に出さない
// （CODING_RULES.md 4.1 / 4.2）。
// ==========================================================================

(() => {
    const form = document.querySelector("[data-post-form]");
    if (!form) return;

    /** 入力できる長さ。サーバー側（worker/index.js）と揃えておく */
    const LIMITS = { title: 120, author: 40, tags: 100, body: 100000 };

    /** 下見を作るまでの待ち時間。1 文字ごとに送らないための間 */
    const PREVIEW_DELAY = 400;

    /** 画像の条件。サーバー側と揃えておく */
    const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
    const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

    const pick = (name) => form.querySelector(`[data-post-${name}]`);
    const fields = {
        title: pick("title"),
        author: pick("author"),
        tags: pick("tags"),
        slug: pick("slug"),
        body: pick("body"),
        website: pick("website"),
        image: pick("image"),
    };
    const preview = pick("preview");
    const message = pick("message");
    const submitButton = pick("submit");
    const done = document.querySelector("[data-post-done]");

    let previewTimer = 0;
    let previewTicket = 0;
    let lastCaret = 0;

    /** 画面に案内を出す。state は "info" / "error" / "success" */
    const showMessage = (text, state = "info") => {
        if (!message) return;

        message.textContent = text;
        message.classList.toggle("p-post__message--error", state === "error");
        message.classList.toggle("p-post__message--success", state === "success");
        message.hidden = false;
    };

    const clearMessage = () => {
        if (!message) return;

        message.textContent = "";
        message.hidden = true;
    };

    // 下見 ------------------------------------------------------------------

    const updatePreview = async () => {
        if (!preview || !fields.body) return;

        const body = fields.body.value;
        if (body.trim() === "") {
            preview.textContent = "";
            return;
        }

        // 打つのが速いと、応答の順番が入れ替わることがある。
        // 最後に送ったものだけを画面に出す。
        previewTicket += 1;
        const ticket = previewTicket;

        try {
            const response = await fetch("/api/preview", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ body }),
            });
            const result = await response.json();

            if (ticket !== previewTicket) return;

            // ここで入れる HTML は、サーバー側（worker/markdown.js）が作ったもの。
            // 生の HTML は文字に置き換えられているので、そのまま入れても安全。
            preview.innerHTML = typeof result.html === "string" ? result.html : "";
        } catch {
            if (ticket !== previewTicket) return;
            preview.textContent = "";
        }
    };

    const schedulePreview = () => {
        window.clearTimeout(previewTimer);
        previewTimer = window.setTimeout(updatePreview, PREVIEW_DELAY);
    };

    // 本文への差し込み ------------------------------------------------------

    /** 本文のカーソル位置。フォーカスが外れているときは、最後にいた場所を使う */
    const caretPosition = () => {
        if (!fields.body) return 0;
        if (document.activeElement === fields.body) return fields.body.selectionStart ?? 0;

        return lastCaret;
    };

    const rememberCaret = () => {
        if (!fields.body) return;
        lastCaret = fields.body.selectionStart ?? lastCaret;
    };

    /** 本文に文字を差し込み、そのすぐ後ろにカーソルを置く */
    const insertIntoBody = (text) => {
        if (!fields.body) return;

        const position = caretPosition();
        fields.body.setRangeText(text, position, position, "end");
        fields.body.focus();
        fields.body.setSelectionRange(position + text.length, position + text.length);
        lastCaret = position + text.length;

        // 値を直接変えても input は起きないので、下見を出すように自分から知らせる
        fields.body.dispatchEvent(new Event("input", { bubbles: true }));
    };

    // 画像 ------------------------------------------------------------------

    const uploadImage = async (file) => {
        if (!file) return;

        if (!IMAGE_TYPES.includes(file.type)) {
            showMessage("画像は PNG / JPEG / GIF / WebP のいずれかにしてください。", "error");
            return;
        }

        if (file.size > IMAGE_MAX_BYTES) {
            showMessage("画像は 5MB までです。", "error");
            return;
        }

        showMessage("画像を上げています…");

        const body = new FormData();
        body.append("image", file);

        try {
            const response = await fetch("/api/images", { method: "POST", body });
            const result = await response.json();

            if (!response.ok || !result.url) {
                showMessage(result.message ?? "画像を上げられませんでした。", "error");
                return;
            }

            // 説明文（alt）はファイル名から作る。本文の中で自由に書き換えられる。
            const name = String(file.name ?? "")
                .replace(/\.[^.]+$/, "")
                .replace(/[[\]]/g, "");

            insertIntoBody(`![${name || "画像"}](${result.url})`);
            showMessage("画像を追加しました。説明文は本文の中で書き換えられます。", "success");
        } catch {
            showMessage("画像を上げられませんでした。通信の状態を確かめてください。", "error");
        }
    };

    // 送る ------------------------------------------------------------------

    /** 送る前に確かめる。直してほしいところがあれば、日本語で返す */
    const findProblem = () => {
        const title = (fields.title?.value ?? "").trim();
        const body = (fields.body?.value ?? "").trim();

        if (title === "") return "タイトルを入力してください。";
        if (title.length > LIMITS.title) {
            return `タイトルは ${LIMITS.title} 文字までにしてください。`;
        }
        if (body === "") return "本文を入力してください。";
        if (body.length > LIMITS.body) return "本文が長すぎます。";
        if ((fields.author?.value ?? "").length > LIMITS.author) {
            return `書いた人は ${LIMITS.author} 文字までにしてください。`;
        }
        if ((fields.tags?.value ?? "").length > LIMITS.tags) {
            return `タグは ${LIMITS.tags} 文字までにしてください。`;
        }
        if (fields.slug && fields.slug.value !== "" && !/^[a-zA-Z0-9-]+$/.test(fields.slug.value)) {
            return "URL の名前は、半角英数字とハイフンだけで入力してください。";
        }

        return "";
    };

    const send = async () => {
        const problem = findProblem();
        if (problem !== "") {
            showMessage(problem, "error");
            return;
        }

        const payload = {
            title: (fields.title?.value ?? "").trim(),
            body: (fields.body?.value ?? "").trim(),
            author: (fields.author?.value ?? "").trim(),
            tags: (fields.tags?.value ?? "").trim(),
            slug: (fields.slug?.value ?? "").trim(),
            website: fields.website?.value ?? "",
        };

        if (submitButton) submitButton.disabled = true;
        showMessage("送っています…");

        try {
            const response = await fetch("/api/columns", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(payload),
            });
            const result = await response.json();

            if (!response.ok || !result.ok) {
                showMessage(result.message ?? "投稿できませんでした。", "error");
                if (submitButton) submitButton.disabled = false;
                return;
            }

            // 受け付けてもらえたら、フォームを片付けて案内を出す
            form.hidden = true;
            if (done) {
                done.hidden = false;
                done.scrollIntoView({ block: "center" });
            }
        } catch {
            showMessage("投稿できませんでした。通信の状態を確かめてください。", "error");
            if (submitButton) submitButton.disabled = false;
        }
    };

    // 動きを組み立てる ------------------------------------------------------

    const setup = () => {
        fields.body?.addEventListener("input", schedulePreview);
        fields.body?.addEventListener("blur", rememberCaret);
        fields.body?.addEventListener("keyup", rememberCaret);
        fields.body?.addEventListener("mouseup", rememberCaret);

        // 貼り付けた画像をそのまま上げる（スクリーンショットを渡すのが楽になる）
        fields.body?.addEventListener("paste", (event) => {
            const item = [...(event.clipboardData?.items ?? [])].find((entry) =>
                entry.type.startsWith("image/"),
            );
            if (!item) return;

            event.preventDefault();
            uploadImage(item.getAsFile());
        });

        fields.body?.addEventListener("dragover", (event) => event.preventDefault());
        fields.body?.addEventListener("drop", (event) => {
            const file = event.dataTransfer?.files?.[0];
            if (!file) return;

            event.preventDefault();
            uploadImage(file);
        });

        fields.image?.addEventListener("change", () => {
            const file = fields.image.files?.[0];
            // 同じ画像をもう一度選び直しても change が起きるように、選んだら空に戻す
            fields.image.value = "";
            uploadImage(file);
        });

        form.addEventListener("submit", (event) => {
            event.preventDefault();
            send();
        });

        schedulePreview();
    };

    setup();
})();
