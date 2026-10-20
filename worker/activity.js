// ==========================================================================
// activity.js — 「活動ページ」の HTML（一覧・スレッド・投稿フォーム）
//
// Discord のチャンネルとスレッドに近い見た目にしている。
//   /activities       …… 公開された活動が、最後の書き込みの新しい順に並ぶ
//   /activities/<id>  …… 1 本の活動（最初の書き込みと、書き足したもの）
//   /activities/new   …… 新しい活動を書く（Discord でログインした人だけ）
//
// 見た目の部品（c-activity）は、一覧とスレッドの両方で使う。
// ==========================================================================

import { ACTIVITY_LIMITS } from "./activities.js";
import { formatAgo, formatJst, layout, SITE_NAME } from "./html.js";
import { escapeHtml } from "./markdown.js";

export const ACTIVITIES_TITLE = "活動";
export const ACTIVITY_DESCRIPTION =
    "サーバーでの出来事や、いま進めていることを、Discord のスレッドのように書き残せます。書けるのは Discord でログインした人だけです。";

/** アイコン。設定していない人には、名前の 1 文字目を丸に入れる */
const renderAvatar = (icon, name) => {
    if (icon) {
        return `<img class="c-activity__avatar" src="${escapeHtml(icon)}" alt="" width="40" height="40" loading="lazy" />`;
    }

    return `<span class="c-activity__avatar c-activity__avatar--blank" aria-hidden="true">${escapeHtml(
        String(name || "?").slice(0, 1),
    )}</span>`;
};

/** 一覧の 1 件 */
const renderCard = (thread, now) => `                    <li class="p-activities__item">
                        <a class="c-activity c-activity--link" href="/activities/${encodeURIComponent(thread.id)}">
${renderAvatar(thread.authorIcon, thread.authorName)}
                            <div class="c-activity__main">
                                <p class="c-activity__head">
                                    <span class="c-activity__author">${escapeHtml(thread.authorName)}</span>
                                    <time class="c-activity__time" datetime="${escapeHtml(thread.updatedAt)}">${escapeHtml(formatAgo(thread.updatedAt, now))}</time>
                                </p>
                                <h2 class="c-activity__title">${escapeHtml(thread.title)}</h2>
                                <p class="c-activity__excerpt">${escapeHtml(thread.excerpt)}</p>
                                <p class="c-activity__meta">${thread.postCount} 件の書き込み</p>
                            </div>
                        </a>
                    </li>`;

/** 活動の一覧 */
export const renderActivityList = ({ threads = [], now = Date.now(), loggedIn = false } = {}) => {
    const list =
        threads.length > 0
            ? `                <ul class="p-activities">
${threads.map((thread) => renderCard(thread, now)).join("\n")}
                </ul>`
            : `                <p class="p-activities__empty">
                    まだ活動はありません。最初の 1 本を書いてみませんか。
                </p>`;

    const body = `            <header class="c-page-header">
                <div class="l-container">
                    <p class="c-page-header__lead">${SITE_NAME} の活動</p>
                    <h1 class="c-page-header__title">${ACTIVITIES_TITLE}</h1>
                    <p class="c-page-header__text">${ACTIVITY_DESCRIPTION}</p>
                    <p class="c-page-header__actions">
                        <a class="c-button" href="/activities/new">${
                            loggedIn ? "活動を書く" : "活動を書く（ログインが要ります）"
                        }</a>
                    </p>
                </div>
            </header>

            <div class="l-container">
${list}
            </div>`;

    return layout({
        title: `${ACTIVITIES_TITLE} | ${SITE_NAME}`,
        description: `${SITE_NAME} の活動（サーバーでの出来事や、進めていること）の一覧です。`,
        body,
    });
};

/** スレッドの 1 件（最初の書き込み・書き足したもの・承認待ち） */
const renderPost = (
    { bodyHtml, authorName, authorIcon, createdAt, badge = "" },
    now,
) => `                    <li class="c-activity${badge === "承認待ち" ? " c-activity--pending" : ""}">
${renderAvatar(authorIcon, authorName)}
                        <div class="c-activity__main">
                            <p class="c-activity__head">
                                <span class="c-activity__author">${escapeHtml(authorName)}</span>
                                <time class="c-activity__time" datetime="${escapeHtml(createdAt)}">${escapeHtml(formatJst(createdAt))}</time>${
                                    badge
                                        ? `
                                <span class="c-activity__badge">${escapeHtml(badge)}</span>`
                                        : ""
                                }
                            </p>
                            <div class="c-prose c-activity__text">
${bodyHtml}
                            </div>
                        </div>
                    </li>`;

/** 活動 1 本のページ */
export const renderActivity = ({
    thread,
    posts = [],
    pendingPosts = [],
    viewer = null,
    isAdmin = false,
    error = "",
    now = Date.now(),
}) => {
    const isAuthor = Boolean(viewer && viewer.id === thread.authorId);
    // 承認待ちの書き込みは、書いた本人と運営にだけ見せる
    const showPending = isAuthor || isAdmin;
    const waiting = showPending && thread.status === "pending";

    const messages = [
        renderPost(
            {
                bodyHtml: thread.bodyHtml,
                authorName: thread.authorName,
                authorIcon: thread.authorIcon,
                createdAt: thread.createdAt,
                badge: "開始",
            },
            now,
        ),
        ...posts.map((post) => renderPost(post, now)),
        ...(showPending
            ? pendingPosts.map((post) => renderPost({ ...post, badge: "承認待ち" }, now))
            : []),
    ].join("\n");

    const notice = waiting
        ? `                <p class="p-activity__notice">
                    ${
                        isAdmin
                            ? "この活動は、まだ承認待ちです。運営として見ています（公開・見送りは /admin/activities から）。"
                            : "この活動は、まだ承認待ちです。運営が公開すると、みんなに見えるようになります（この画面はあなたにだけ見えています）。"
                    }
                </p>`
        : "";

    const form = isAuthor
        ? `                <form class="p-activity__form" method="post" action="/activities/${encodeURIComponent(thread.id)}/posts">
                    <div class="p-activity__field">
                        <label class="p-activity__label" for="activity-body">書き足す</label>
                        <textarea
                            class="p-activity__textarea"
                            id="activity-body"
                            name="body"
                            rows="5"
                            maxlength="${ACTIVITY_LIMITS.body}"
                            placeholder="その後の様子や、次にやることを書き足せます"
                            required
                        ></textarea>
                    </div>
                    <p class="p-activity__actions">
                        <button class="c-button" type="submit">書き込む</button>
                        <span class="p-activity__note">運営が承認すると出ます。</span>
                    </p>
                </form>`
        : `                <p class="p-activity__note">
                    書き足せるのは、この活動を立てた本人だけです。
                </p>`;

    const body = `            <header class="c-page-header">
                <div class="l-container">
                    <p class="c-page-header__lead">
                        <a class="p-activity__back" href="/activities">${ACTIVITIES_TITLE}</a>
                    </p>
                    <h1 class="c-page-header__title">${escapeHtml(thread.title)}</h1>
                    <p class="c-page-header__text">
                        <time datetime="${escapeHtml(thread.createdAt)}">${escapeHtml(formatJst(thread.createdAt))}</time>
                        ・${thread.postCount} 件の書き込み
                    </p>
                </div>
            </header>

            <div class="l-container l-container--narrow">
${notice}${
        error
            ? `
                <p class="p-activity__error" role="alert">${escapeHtml(error)}</p>`
            : ""
    }
                <ol class="p-activity__posts" id="posts">
${messages}
                </ol>

${form}
            </div>`;

    return layout({
        title: `${thread.title} | ${ACTIVITIES_TITLE} | ${SITE_NAME}`,
        description: `${thread.authorName} さんの活動（${SITE_NAME}）`,
        body,
        // 承認待ちのものは、検索から入れない
        noindex: thread.status !== "published",
    });
};

/** 新しい活動を書くページ（ログインしている人） */
export const renderActivityForm = ({ user, values = { title: "", body: "" }, error = "" }) => {
    const body = `            <header class="c-page-header">
                <div class="l-container">
                    <p class="c-page-header__lead">
                        <a class="p-activity__back" href="/activities">${ACTIVITIES_TITLE}</a>
                    </p>
                    <h1 class="c-page-header__title">活動を書く</h1>
                    <p class="c-page-header__text">
                        ${escapeHtml(user.name)} さんとして書きます。公開は、運営が承認してからです。
                    </p>
                </div>
            </header>

            <div class="l-container l-container--narrow">
${
    error
        ? `                <p class="p-activities__error" role="alert">${escapeHtml(error)}</p>
`
        : ""
}                <form class="p-activities__form" method="post" action="/activities">
                    <div class="p-activities__field">
                        <label class="p-activities__label" for="activity-title">タイトル</label>
                        <input
                            class="p-activities__input"
                            id="activity-title"
                            name="title"
                            type="text"
                            maxlength="${ACTIVITY_LIMITS.title}"
                            value="${escapeHtml(values.title)}"
                            placeholder="例: ハードモード、Moon Lord まであと少し"
                            required
                        />
                        <p class="p-activities__hint">
                            一覧に出る見出しです（${ACTIVITY_LIMITS.title} 文字まで）。
                        </p>
                    </div>

                    <div class="p-activities__field">
                        <label class="p-activities__label" for="activity-body">本文</label>
                        <textarea
                            class="p-activities__textarea"
                            id="activity-body"
                            name="body"
                            rows="12"
                            maxlength="${ACTIVITY_LIMITS.body}"
                            placeholder="いまの状況や、次にやることなど。Markdown が使えます（改行はそのまま出ます）。"
                            required
                        >${escapeHtml(values.body)}</textarea>
                        <p class="p-activities__hint">
                            あとから、このページで書き足せます。書き足したぶんも承認してから出ます。
                        </p>
                    </div>

                    <p class="p-activities__actions">
                        <button class="c-button" type="submit">書く（承認待ちで保存）</button>
                        <a class="c-button c-button--ghost" href="/activities">やめる</a>
                    </p>
                </form>
            </div>`;

    return layout({
        title: `活動を書く | ${ACTIVITIES_TITLE} | ${SITE_NAME}`,
        description: `${SITE_NAME} に活動を書きます。`,
        body,
        noindex: true,
    });
};

/** ログインしていない人に、ログインの入口を出す */
export const renderActivityLogin = () => {
    const body = `            <header class="c-page-header">
                <div class="l-container">
                    <p class="c-page-header__lead">
                        <a class="p-activity__back" href="/activities">${ACTIVITIES_TITLE}</a>
                    </p>
                    <h1 class="c-page-header__title">活動を書く</h1>
                </div>
            </header>

            <div class="l-container l-container--narrow">
                <div class="p-activities__login">
                    <p class="p-activities__login-text">
                        活動を書くには、Discord でログインしてください。誰が書いたかが分かるようにするためです（読み取りだけの権限で、メールなどは取りません）。
                    </p>
                    <p class="p-activities__actions">
                        <a class="c-button" href="/auth/discord?next=${encodeURIComponent("/activities/new")}">Discord でログイン</a>
                        <a class="c-button c-button--ghost" href="/activities">活動を見る</a>
                    </p>
                </div>
            </div>`;

    return layout({
        title: `活動を書く | ${ACTIVITIES_TITLE} | ${SITE_NAME}`,
        description: `${SITE_NAME} に活動を書くには、Discord でのログインが必要です。`,
        body,
        noindex: true,
    });
};

/** 活動が見つからないとき（消えた・見送りになった・URL 違い） */
export const renderActivityMissing = () => {
    const body = `            <header class="c-page-header">
                <div class="l-container">
                    <p class="c-page-header__lead">404</p>
                    <h1 class="c-page-header__title">活動が見つかりません</h1>
                    <p class="c-page-header__text">
                        消えているか、公開が取り下げられたかもしれません。
                    </p>
                    <p class="c-page-header__actions">
                        <a class="c-button" href="/activities">${ACTIVITIES_TITLE}の一覧へ</a>
                    </p>
                </div>
            </header>`;

    return layout({
        title: `活動が見つかりません | ${SITE_NAME}`,
        description: "お探しの活動は見つかりませんでした。",
        body,
        noindex: true,
    });
};
