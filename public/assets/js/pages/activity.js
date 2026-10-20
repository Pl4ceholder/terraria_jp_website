// ==========================================================================
// activity.js — 活動を書く・書き足すページの動き
//
// やることは 2 つ（コラムの post.js と同じ考え方）。
//   1. 書いた文章の下見を出す（/api/preview。公開される見た目と同じものが返る）
//   2. 画像を上げて、本文のカーソル位置に Markdown として入れる（/api/images）
//
// 送信はふつうのフォームのまま。JavaScript が無くても、文章だけなら書ける。
// 通常の <script> はグローバルを共有するので、名前は外に出さない
// （CODING_RULES.md 4.1 / 4.2）。
// ==========================================================================

(() => {
    const forms = document.querySelectorAll("[data-activity-form]");
    if (forms.length === 0) return;

    /** 下見を作るまでの待ち時間。1 文字ごとに送らないための間 */
    const PREVIEW_DELAY = 400;

    /** 画像の条件。サーバー側（worker/index.js）と揃えておく */
    const IMAGE_MAX_BYTES = 1 * 1024 * 1024;
    const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

    forms.forEach((form) => {
        const body = form.querySelector("[data-activity-body]");
        if (!body) return;

        const preview = form.querySelector("[data-activity-preview]");
        const image = form.querySelector("[data-activity-image]");
        const message = form.querySelector("[data-activity-message]");

        let previewTimer = 0;
        let previewTicket = 0;
        let lastCaret = 0;

        /** 画面に案内を出す。state は "info" / "error" / "success" */
        const showMessage = (text, state = "info") => {
            if (!message) return;

            message.textContent = text;
            message.classList.toggle("c-editor__message--error", state === "error");
            message.classList.toggle("c-editor__message--success", state === "success");
            message.hidden = false;
        };

        // 下見 --------------------------------------------------------------

        const updatePreview = async () => {
            if (!preview) return;

            const value = body.value;
            if (value.trim() === "") {
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
                    body: JSON.stringify({ body: value }),
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

        // 本文への差し込み --------------------------------------------------

        /** 本文のカーソル位置。フォーカスが外れているときは、最後にいた場所を使う */
        const caretPosition = () => {
            if (document.activeElement === body) return body.selectionStart ?? 0;

            return lastCaret;
        };

        const rememberCaret = () => {
            lastCaret = body.selectionStart ?? lastCaret;
        };

        /** 本文に文字を差し込み、そのすぐ後ろにカーソルを置く */
        const insertIntoBody = (text) => {
            const position = caretPosition();
            body.setRangeText(text, position, position, "end");
            body.focus();
            body.setSelectionRange(position + text.length, position + text.length);
            lastCaret = position + text.length;

            // 値を直接変えても input は起きないので、下見を出すように自分から知らせる
            body.dispatchEvent(new Event("input", { bubbles: true }));
        };

        // 画像 --------------------------------------------------------------

        const uploadImage = async (file) => {
            if (!file) return;

            if (!IMAGE_TYPES.includes(file.type)) {
                showMessage("画像は PNG / JPEG / GIF / WebP のいずれかにしてください。", "error");
                return;
            }

            if (file.size > IMAGE_MAX_BYTES) {
                showMessage("画像は 1MB までです。", "error");
                return;
            }

            showMessage("画像を上げています…");

            const data = new FormData();
            data.append("image", file);

            try {
                const response = await fetch("/api/images", { method: "POST", body: data });
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

        // 動きを組み立てる --------------------------------------------------

        body.addEventListener("input", schedulePreview);
        body.addEventListener("blur", rememberCaret);
        body.addEventListener("keyup", rememberCaret);
        body.addEventListener("mouseup", rememberCaret);

        // 貼り付けた画像をそのまま上げる（スクリーンショットを渡すのが楽になる）
        body.addEventListener("paste", (event) => {
            const item = [...(event.clipboardData?.items ?? [])].find((entry) =>
                entry.type.startsWith("image/"),
            );
            if (!item) return;

            event.preventDefault();
            uploadImage(item.getAsFile());
        });

        body.addEventListener("dragover", (event) => event.preventDefault());
        body.addEventListener("drop", (event) => {
            const file = event.dataTransfer?.files?.[0];
            if (!file) return;

            event.preventDefault();
            uploadImage(file);
        });

        image?.addEventListener("change", () => {
            const file = image.files?.[0];
            // 同じ画像をもう一度選び直しても change が起きるように、選んだら空に戻す
            image.value = "";
            uploadImage(file);
        });

        // 前の送信で書き直しになったときは、最初から下見を出しておく
        if (body.value.trim() !== "") updatePreview();
    });
})();
