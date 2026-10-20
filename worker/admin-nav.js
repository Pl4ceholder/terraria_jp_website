// ==========================================================================
// admin-nav.js — 運営ページ共通のサイドメニュー
//
// コラムの承認・活動の管理・実績の付与は、どれも同じ入口から行き来する。
// ページごとに書き写すとリンクがずれるので、ここ 1 か所で作る。
//
// 見た目は assets/css/common/components.css（c-admin-sidebar）にある。
// 狭い画面では上に、広い画面では左に固定する（l-admin）。
// ==========================================================================

const LINKS = [
    ["/admin/columns", "コラムの承認"],
    ["/admin/activities", "活動の管理"],
    ["/admin/achievements", "実績の付与・剥奪"],
];

/** いま見ているページ（current）だけ aria-current を付ける */
export const renderAdminNav = (
    current,
) => `                <aside class="c-admin-sidebar" aria-label="運営メニュー">
                    <p class="c-admin-sidebar__title">運営メニュー</p>
                    <nav aria-label="運営のページ">
                        <ul class="c-admin-sidebar__list">
${LINKS.map(
    ([href, label]) =>
        `                            <li><a class="c-admin-sidebar__link" href="${href}"${
            href === current ? ' aria-current="page"' : ""
        }>${label}</a></li>`,
).join("\n")}
                        </ul>
                    </nav>
                </aside>`;
