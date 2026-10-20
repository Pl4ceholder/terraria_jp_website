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
// match は「その項目を現在地とみなすページ」の判定。href とページ名が一致しない
// 下の階層のページ（columns/xxx.html など）をまとめて指したいときに使う。
const NAV_ITEMS = [
    { label: "ホーム", href: "./" },
    { label: "お知らせ", href: "./news.html" },
    {
        label: "コラム",
        href: "./columns.html",
        match: (path) => path.includes("/columns/"),
    },
    {
        label: "活動",
        href: "./activities",
        match: (path) => path.includes("/activities"),
    },
    {
        label: "マルチ募集",
        href: "./recruit.html",
        match: (path) => path.includes("/recruit"),
    },
    { label: "サーバー紹介", href: "./server.html" },
    {
        label: "マイページ",
        href: "./mypage",
        match: (path) => path.includes("/mypage"),
    },
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
 * ナビの項目が今開いているページかどうかを判定する。
 * 末尾の index.html は同じページとして扱う。
 * match を持つ項目は、その判定だけを使う。
 */
const isCurrentPage = (item) => {
    if (typeof item.match === "function") {
        return item.match(location.pathname);
    }
    const normalize = (path) => path.replace(/index\.html$/, "");
    return normalize(new URL(item.href, SiteHeader.root).pathname) === normalize(location.pathname);
};

class SiteHeader extends HTMLElement {
    /**
     * サイトのルート（トップページのある場所）を、このスクリプト自身の URL から求める。
     * ヘッダーは columns/xxx.html のような 1 つ下の階層のページにも入るため、
     * ページからの相対パスだけではリンク先がずれてしまう。
     * ここをトップレベルの変数にすると、通常の <script> はグローバルを共有するので
     * 同じ名前を使う他のコンポーネントと衝突して壊れる。クラスの中に閉じ込めておく。
     * site-footer.js にも同じ計算がある（共有するにはグローバル変数かモジュールが要るため、
     * CODING_RULES.md 4.2 に従ってあえて重複させている）。
     */
    static root = (() => {
        const scriptUrl = document.currentScript?.src ?? "";
        return scriptUrl ? new URL("../../../", scriptUrl).href : new URL("./", location.href).href;
    })();

    /** サイトのルートからの相対パスを、どの階層のページでも通じる URL にする */
    static url(path) {
        return new URL(path, SiteHeader.root).href;
    }

    connectedCallback() {
        if (this.dataset.ready === "true") return;
        this.dataset.ready = "true";

        this.append(HEADER_TEMPLATE.content.cloneNode(true));
        this.setupLogo();
        this.renderNav();
        this.setupMenu();
    }

    /** ロゴをどのページからでもトップページへ戻す */
    setupLogo() {
        const logo = this.querySelector(".l-header__logo");
        if (logo) {
            logo.href = SiteHeader.url("./");
        }
    }

    /** ナビの項目を組み立てる */
    renderNav() {
        const list = this.querySelector(".l-header__nav-list");
        if (!list) return;

        for (const item of NAV_ITEMS) {
            const link = document.createElement("a");
            link.className = "l-header__nav-link";
            link.href = SiteHeader.url(item.href);
            link.textContent = item.label;

            if (isCurrentPage(item)) {
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
