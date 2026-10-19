// ==========================================================================
// mypage.js — マイページ（/mypage）の HTML
//
// ログイン前は、Discord で入る案内だけを出す。ログイン後は、その人が解放した実績を出す。
//
// 実績の中身は bot から届いた写し（POST /api/internal/achievements）。ここは、D1 から
// 読んだものを並べるだけ。付与は Discord で手動なので、出るまで少し間が空く
// （bot は 30 分に 1 回送る）。
//
// 見た目は assets/css/pages/mypage.css（p-mypage）にある。
// ==========================================================================

import { escapeHtml } from "./markdown.js";
import { formatAgo, formatJst, layout, SITE_NAME } from "./html.js";

export const MYPAGE_TITLE = "マイページ";

/** 最終更新から、この分数を過ぎたら「古いかもしれない」と伝える（bot は 30 分ごとに送る） */
const STALE_MINUTES = 90;

/** 実績 1 件。いま称号にしているものには印を付ける */
const renderAchievement = (achievement) => {
    const worn =
        Number(achievement.worn) === 1
            ? `
                                <span class="p-mypage__badge">装着中</span>`
            : "";
    const name = escapeHtml(achievement.name || "名前なし");

    return `                            <li class="p-mypage__item">
                                <span class="p-mypage__achievement">${name}</span>${worn}
                            </li>`;
};

/**
 * 解放した実績の一覧。
 *
 * 出すのは解放済みのものだけ（まだのものは出さない）。実績そのものがまだ届いていない
 * ときは、そう伝える（「まだ持っていない」と見分けが付くように）。
 */
const renderAchievements = (achievements) => {
    if (achievements.length === 0) {
        return `                        <p class="p-mypage__empty">
                            いま実績の準備中です。Discord の運営が実績を設定すると、ここに出ます。
                        </p>`;
    }

    const unlocked = achievements.filter((achievement) => Number(achievement.unlocked) === 1);

    if (unlocked.length === 0) {
        return `                        <p class="p-mypage__empty">
                            まだ解放した実績はありません。Discord の運営が実績を付けると、ここに出ます。
                        </p>`;
    }

    const note = unlocked.some((achievement) => Number(achievement.worn) === 1)
        ? `
                        <p class="p-mypage__note">
                            「装着中」は、いま Discord で称号にしている実績です。
                        </p>`
        : "";

    return `                        <ul class="p-mypage__list">
${unlocked.map(renderAchievement).join("\n")}
                        </ul>${note}`;
};

/** 最終更新の案内。古くなっていたら、そのことも伝える */
const renderUpdated = (syncedAt, now) => {
    if (!syncedAt) return "";

    const minutes = Math.floor((now - Date.parse(syncedAt)) / 60000);
    const stale = !Number.isFinite(minutes) || minutes >= STALE_MINUTES;
    const when = `${escapeHtml(formatJst(syncedAt))}（${escapeHtml(formatAgo(syncedAt, now))}）`;

    return `                        <p class="p-mypage__updated">
                            最終更新: ${when}${
                                stale
                                    ? `
                            <br />
                            <span class="p-mypage__warning"
                                >Discord 側の更新が止まっているかもしれません。表示は少し古い可能性があります。</span
                            >`
                                    : ""
                            }
                        </p>
`;
};

/** ログインしている人のページ */
export const renderMypage = ({ user, achievements, syncedAt, now = Date.now() }) => {
    const icon = user.avatar
        ? `<img class="p-mypage__avatar" src="${escapeHtml(
              user.avatar,
          )}" alt="" width="64" height="64" />`
        : "";

    const body = `            <header class="c-page-header">
                <div class="l-container l-container--narrow">
                    <p class="c-page-header__lead">${SITE_NAME} の Discord</p>
                    <h1 class="c-page-header__title">${MYPAGE_TITLE}</h1>
                    <p class="c-page-header__text">
                        あなたが解放した実績の一覧です。解放した実績は、Discord で称号として付けられます。
                    </p>
                </div>
            </header>

            <div class="l-container l-container--narrow">
                <div class="p-mypage">
                    <section class="p-mypage__profile">
                        ${icon}
                        <p class="p-mypage__who">
                            <span class="p-mypage__name">${escapeHtml(user.name)}</span>
                            <span class="p-mypage__note">Discord のアカウントで入っています。</span>
                        </p>
                        <form class="p-mypage__logout" method="post" action="/auth/logout">
                            <button class="c-button c-button--small" type="submit">ログアウト</button>
                        </form>
                    </section>

                    <section class="p-mypage__section">
                        <h2 class="p-mypage__heading">解放した実績</h2>
${renderUpdated(syncedAt, now)}${renderAchievements(achievements)}
                    </section>
                </div>
            </div>`;

    return layout({
        title: `${MYPAGE_TITLE} | ${SITE_NAME}`,
        description: `${SITE_NAME} のマイページです。Discord で解放した実績を見られます。`,
        body,
    });
};

/** ログインしていない人のページ */
export const renderLogin = () => {
    const body = `            <header class="c-page-header">
                <div class="l-container l-container--narrow">
                    <p class="c-page-header__lead">${SITE_NAME} の Discord</p>
                    <h1 class="c-page-header__title">${MYPAGE_TITLE}</h1>
                    <p class="c-page-header__text">
                        Discord でログインすると、自分が解放した実績の一覧が出ます。
                    </p>
                </div>
            </header>

            <div class="l-container l-container--narrow">
                <div class="p-mypage">
                    <div class="p-mypage__login">
                        <p class="p-mypage__actions">
                            <a class="c-button" href="/auth/discord">Discord でログイン</a>
                        </p>
                        <p class="p-mypage__note">
                            読み取るのは、あなたの Discord のアカウント名とアイコンだけです。メールアドレスなどは取りません。
                        </p>
                    </div>
                </div>
            </div>`;

    return layout({
        title: `${MYPAGE_TITLE} | ${SITE_NAME}`,
        description: `${SITE_NAME} のマイページです。Discord でログインすると、解放した実績を見られます。`,
        body,
    });
};

/** ログインの設定がまだのときのページ */
export const renderUnconfigured = () =>
    layout({
        title: `${MYPAGE_TITLE} | ${SITE_NAME}`,
        description: `${SITE_NAME} のマイページです。`,
        body: `            <header class="c-page-header">
                <div class="l-container l-container--narrow">
                    <p class="c-page-header__lead">${SITE_NAME} の Discord</p>
                    <h1 class="c-page-header__title">${MYPAGE_TITLE}</h1>
                    <p class="c-page-header__text">
                        マイページは、ただいま準備中です。もうしばらくお待ちください。
                    </p>
                </div>
            </header>`,
    });

/** ログインの途中でうまくいかなかったときのページ（理由はログにだけ出す） */
export const renderAuthError = () =>
    layout({
        title: `ログインできませんでした | ${SITE_NAME}`,
        description: "Discord でのログインが、途中でうまくいきませんでした。",
        body: `            <header class="c-page-header">
                <div class="l-container l-container--narrow">
                    <p class="c-page-header__lead">${SITE_NAME} の Discord</p>
                    <h1 class="c-page-header__title">ログインできませんでした</h1>
                    <p class="c-page-header__text">
                        Discord とのやりとりが、途中でうまくいきませんでした。お手数ですが、もう一度お試しください。
                    </p>
                    <p class="c-page-header__actions">
                        <a class="c-button" href="/mypage">マイページへ戻る</a>
                    </p>
                </div>
            </header>`,
    });
