// ==========================================================================
// admin.js — コラムの承認（admin/columns.html）の動き
//
// 合言葉で入って、承認待ち・公開中・見送りを切り替えながら読む。
// 公開してもサイトを上げ直す必要はない（保存場所が変わるだけ）。
//
// 通常の <script> はグローバルを共有するので、名前は外に出さない
// （CODING_RULES.md 4.1 / 4.2）。
// ==========================================================================

(() => {
    const login = document.querySelector("[data-admin-login]");
    const loginForm = document.querySelector("[data-admin-login-form]");
    const password = document.querySelector("[data-admin-password]");
    const loginMessage = document.querySelector("[data-admin-login-message]");
    const loginSubmit = document.querySelector("[data-admin-login-submit]");
    const panel = document.querySelector("[data-admin-panel]");
    const list = document.querySelector("[data-admin-list]");
    const message = document.querySelector("[data-admin-message]");
    const logout = document.querySelector("[data-admin-logout]");
    const filters = [...document.querySelectorAll("[data-admin-filter]")];

    let currentStatus = "pending";

    /** 2026-10-19T… を 2026.10.19 にする */
    const formatDate = (value) => String(value).slice(0, 10).replaceAll("-", ".") || "－";

    /** 画面に案内を出す。state は "info" / "error" / "success" */
    const showMessage = (target, text, state = "info") => {
        if (!target) return;

        target.textContent = text;
        target.classList.toggle("p-admin__message--error", state === "error");
        target.classList.toggle("p-admin__message--success", state === "success");
        target.hidden = false;
    };

    const clearMessage = (target) => {
        if (!target) return;

        target.textContent = "";
        target.hidden = true;
    };

    /** サーバーとやりとりする。返事はいつも JSON */
    const request = async (path, options = {}) => {
        try {
            const response = await fetch(path, {
                headers: { "content-type": "application/json" },
                ...options,
            });
            const result = await response.json();

            return {
                ok: response.ok && result.ok === true,
                status: response.status,
                message: typeof result.message === "string" ? result.message : "",
                data: result,
            };
        } catch {
            return { ok: false, status: 0, message: "通信できませんでした。", data: {} };
        }
    };

    /** 状態ごとの件数を、切り替えのボタンに出す */
    const showCounts = (counts) => {
        for (const [name, count] of Object.entries(counts ?? {})) {
            const badge = document.querySelector(`[data-admin-count="${name}"]`);
            if (badge) badge.textContent = String(count);
        }
    };

    /** その状態でできる操作。label はボタンの文字、done は操作のあとの案内に使う */
    const actionsFor = (status) => {
        const remove = {
            action: "delete",
            label: "削除",
            done: "削除しました",
            danger: true,
            confirm: "この投稿を完全に削除します。元に戻せません。",
        };

        const back = { action: "pending", label: "承認待ちに戻す", done: "承認待ちに戻しました" };

        if (status === "published") {
            return [back, { action: "reject", label: "見送る", done: "見送りました" }, remove];
        }

        if (status === "rejected") {
            return [{ action: "publish", label: "公開する", done: "公開しました" }, back, remove];
        }

        return [
            { action: "publish", label: "公開する", done: "公開しました" },
            { action: "reject", label: "見送る", done: "見送りました" },
            remove,
        ];
    };

    /** 操作をサーバーに伝える */
    const act = async (column, action) => {
        if (action.confirm && !window.confirm(`${action.confirm}\n\n「${column.title}」`)) return;

        const result = await request(`/api/admin/columns/${encodeURIComponent(column.id)}`, {
            method: "POST",
            body: JSON.stringify({ action: action.action }),
        });

        if (!result.ok) {
            if (result.status === 401) return showLogin("もう一度、合言葉を入れてください。");
            return showMessage(message, result.message || "操作できませんでした。", "error");
        }

        // 一覧を読み直してから案内を出す（読み直しのときに案内を消しているため）
        if (await load(currentStatus)) {
            showMessage(message, `「${column.title}」を${action.done}。`, "success");
        }
    };

    /** 投稿 1 件分の表示 */
    const buildItem = (column) => {
        const item = document.createElement("article");
        item.className = "p-admin__item";

        const title = document.createElement("h3");
        title.className = "p-admin__item-title";
        title.textContent = column.title;

        const meta = document.createElement("p");
        meta.className = "p-admin__item-meta";
        meta.textContent = [
            `投稿: ${formatDate(column.createdAt)}`,
            column.publishedAt ? `公開: ${formatDate(column.publishedAt)}` : "",
            column.author ? `書いた人: ${column.author}` : "",
            column.tags.length > 0 ? `タグ: ${column.tags.join(", ")}` : "",
        ]
            .filter(Boolean)
            .join(" ・ ");

        const details = document.createElement("details");
        details.className = "p-admin__details";

        const summary = document.createElement("summary");
        summary.className = "p-admin__summary";
        summary.textContent = "本文を読む";

        const body = document.createElement("div");
        body.className = "c-prose p-admin__body";
        // ここに入る HTML はサーバー側（worker/markdown.js）が作ったもの。
        // 生の HTML は文字に置き換えられているので、そのまま入れても安全。
        body.innerHTML = column.html;

        details.append(summary, body);

        const actions = document.createElement("div");
        actions.className = "p-admin__actions";

        for (const action of actionsFor(column.status)) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = `c-button c-button--small${
                action.danger ? " c-button--danger" : ""
            }`;
            button.textContent = action.label;
            button.addEventListener("click", () => act(column, action));
            actions.append(button);
        }

        if (column.status === "published") {
            const link = document.createElement("a");
            link.className = "p-admin__link";
            link.href = `/columns/${encodeURIComponent(column.slug)}.html`;
            link.textContent = "公開中の記事を見る";
            actions.append(link);
        }

        item.append(title, meta, details, actions);

        return item;
    };

    const renderList = (columns) => {
        list.textContent = "";

        if (columns.length === 0) {
            const empty = document.createElement("p");
            empty.className = "p-admin__empty";
            empty.textContent = "ここには何もありません。";
            list.append(empty);
            return;
        }

        for (const column of columns) {
            list.append(buildItem(column));
        }
    };

    /** 一覧を読み込む */
    const load = async (status) => {
        currentStatus = status;

        for (const filter of filters) {
            filter.classList.toggle(
                "p-admin__filter--active",
                filter.dataset.adminFilter === status,
            );
        }

        clearMessage(message);

        const result = await request(`/api/admin/columns?status=${encodeURIComponent(status)}`);

        if (!result.ok) {
            if (result.status === 401) {
                showLogin("もう一度、合言葉を入れてください。");
                return false;
            }

            showMessage(message, result.message || "読み込めませんでした。", "error");
            return false;
        }

        showCounts(result.data.counts);
        renderList(result.data.columns ?? []);

        return true;
    };

    // 出入り ------------------------------------------------------------------

    const showPanel = () => {
        login.hidden = true;
        panel.hidden = false;
        clearMessage(loginMessage);
    };

    const showLogin = (text = "") => {
        panel.hidden = true;
        list.textContent = "";
        login.hidden = false;

        if (text !== "") showMessage(loginMessage, text, "error");
        password.focus();
    };

    const enter = async (event) => {
        event.preventDefault();

        loginSubmit.disabled = true;
        showMessage(loginMessage, "確かめています…");

        const result = await request("/api/admin/session", {
            method: "POST",
            body: JSON.stringify({ password: password.value }),
        });

        loginSubmit.disabled = false;

        if (!result.ok) {
            showMessage(loginMessage, result.message || "入れませんでした。", "error");
            return;
        }

        password.value = "";
        showPanel();
        await load("pending");
    };

    const leave = async () => {
        await request("/api/admin/session", { method: "DELETE" });
        showLogin();
    };

    loginForm.addEventListener("submit", enter);
    logout.addEventListener("click", leave);

    for (const filter of filters) {
        filter.addEventListener("click", () => load(filter.dataset.adminFilter));
    }

    /** 開いたときに、すでに入っているかどうかを確かめる */
    const start = async () => {
        const result = await request("/api/admin/session");

        if (!result.ok) return showLogin();

        showPanel();
        await load("pending");
    };

    start();
})();
