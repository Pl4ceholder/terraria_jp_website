// ==========================================================================
// site-footer.js — 共通フッター（Web Component）
//
// 使い方: 各ページの </body> 直前に置く
//     <x-site-footer></x-site-footer>
//     <script src="assets/js/components/site-footer.js" defer></script>
//
// 見た目は assets/css/common/layout.css と components.css にある。
// site-header.js と同じく、file:// でも GitHub Pages でも動く書き方にしている。
// ==========================================================================

// アイコンの SVG パス（24x24、Simple Icons の配布データ）
const ICON_PATHS = {
    youtube:
        "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
    discord:
        "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z",
    x: "M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z",
};

// SNS リンク。本番の URL が決まったら href を差し替える（今はホームへの仮置き）。
const SOCIAL_LINKS = [
    { label: "YouTube", href: "./", icon: "youtube" },
    { label: "Discord", href: "./", icon: "discord" },
    { label: "X", href: "./", icon: "x" },
];

const SVG_NS = "http://www.w3.org/2000/svg";

const FOOTER_TEMPLATE = document.createElement("template");
FOOTER_TEMPLATE.innerHTML = `
    <footer class="l-footer">
        <div class="l-container">
            <ul class="c-social"></ul>
            <p class="l-footer__copyright">
                <small>&copy; <span data-current-year></span> Terraria JP</small>
            </p>
        </div>
    </footer>
`;

/** アイコンの SVG を作る。装飾なので aria-hidden にし、名前はリンク側に持たせる */
const createIcon = (name) => {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "c-social__icon");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", ICON_PATHS[name]);
    svg.append(path);

    return svg;
};

class SiteFooter extends HTMLElement {
    connectedCallback() {
        if (this.dataset.ready === "true") return;
        this.dataset.ready = "true";

        this.append(FOOTER_TEMPLATE.content.cloneNode(true));
        this.renderSocialLinks();
        this.fillCurrentYear();
    }

    /** SNS のアイコンリンクを組み立てる */
    renderSocialLinks() {
        const list = this.querySelector(".c-social");
        if (!list) return;

        for (const { label, href, icon } of SOCIAL_LINKS) {
            const link = document.createElement("a");
            link.className = "c-social__link";
            link.href = href;
            // アイコンだけのリンクなので、読み上げ用の名前を必ず付ける
            link.setAttribute("aria-label", label);

            // 外部リンクになったら別タブで開く（CODING_RULES.md 第 2 章）
            if (/^https?:/.test(href)) {
                link.target = "_blank";
                link.rel = "noopener noreferrer";
            }

            link.append(createIcon(icon));

            const item = document.createElement("li");
            item.className = "c-social__item";
            item.append(link);
            list.append(item);
        }
    }

    /** コピーライトの年を埋める */
    fillCurrentYear() {
        const year = this.querySelector("[data-current-year]");
        if (!year) return;
        year.textContent = String(new Date().getFullYear());
    }
}

if (!customElements.get("x-site-footer")) {
    customElements.define("x-site-footer", SiteFooter);
}
