// ==========================================================================
// site-header.js — 共通ヘッダ（Web Component）
//
// 使い方: 各ページの <body> の先頭に置く
//     <x-site-header></x-site-header>
//     <script src="assets/js/components/site-header.js" defer></script>
//
// 見た目は assets/css/common/layout.css の .l-header 系にある。
// 通常の <script defer> とテンプレート内蔵にしているので、
// file:// でも GitHub Pages でも同じように動く。
// ==========================================================================

// ナビの項目。ページができたら href を合わせる（今は仮）。
const NAV_ITEMS = [
    { label: "ホーム", href: "./" },
    { label: "お知らせ", href: "./news.html" },
    { label: "サーバー紹介", href: "./server.html" },
    { label: "参加方法", href: "./join.html" },
];

const HEADER_TEMPLATE = document.createElement("template");
HEADER_TEMPLATE.innerHTML = `
    <header class="l-header">
        <a class="l-header__logo" href="./">Terraria JP</a>
        <button
            class="l-header__toggle"
            type="button"
            aria-expanded="false"
            aria-controls="site-nav"
        >
            メニュー
        </button>
        <nav class="l-header__nav" id="site-nav" aria-label="メインメニュー">
            <ul class="l-header__nav-list"></ul>
        </nav>
    </header>
`;

/**
 * リンク先が今開いているページかどうかを判定する。
 * 末尾の index.html は同じページとして扱う。
 */
const isCurrentPage = (href) => {
    const normalize = (path) => path.replace(/index\.html$/, "");
    return normalize(new URL(href, location.href).pathname) === normalize(location.pathname);
};

class SiteHeader extends HTMLElement {
    connectedCallback() {
        if (this.dataset.ready === "true") return;
        this.dataset.ready = "true";

        this.append(HEADER_TEMPLATE.content.cloneNode(true));
        this.renderNav();
        this.setupMenu();
    }

    /** ナビの項目を組み立てる */
    renderNav() {
        const list = this.querySelector(".l-header__nav-list");
        if (!list) return;

        for (const item of NAV_ITEMS) {
            const link = document.createElement("a");
            link.className = "l-header__nav-link";
            link.href = item.href;
            link.textContent = item.label;

            if (isCurrentPage(item.href)) {
                link.setAttribute("aria-current", "page");
            }

            const listItem = document.createElement("li");
            listItem.append(link);
            list.append(listItem);
        }
    }

    /** 狭い画面用の開閉メニュー */
    setupMenu() {
        const header = this.querySelector(".l-header");
        const toggle = this.querySelector(".l-header__toggle");
        if (!header || !toggle) return;

        toggle.addEventListener("click", () => {
            const next = header.dataset.open !== "true";
            header.dataset.open = String(next);
            toggle.setAttribute("aria-expanded", String(next));
        });
    }
}

if (!customElements.get("x-site-header")) {
    customElements.define("x-site-header", SiteHeader);
}
