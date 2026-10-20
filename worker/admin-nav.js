// ==========================================================================
// admin-nav.js — 運営ページ共通のナビ
//
// コラムの承認・活動の管理・実績の付与は、どれも同じ入口から行き来する。
// ページごとに書き写すとリンクがずれるので、ここ 1 か所で作る。
// ==========================================================================

const LINKS = [
    ["/admin/columns", "コラムの承認"],
    ["/admin/activities", "活動の管理"],
    ["/admin/achievements", "実績の付与・剥奪"],
];

/** いま見ているページ（current）だけ aria-current を付ける */
export const renderAdminNav = (
    current,
) => `                <nav class="c-admin-nav" aria-label="運営のページ">
${LINKS.map(([href, label]) =>
    href === current
        ? `                    <a class="c-admin-nav__link" href="${href}" aria-current="page">${label}</a>`
        : `                    <a class="c-admin-nav__link" href="${href}">${label}</a>`,
).join("\n")}
                </nav>`;
