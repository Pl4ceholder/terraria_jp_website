// ==========================================================================
// activity.js — 「活動ページ」の HTML（一覧・スレッド・投稿フォーム）
//
// Discord のチャンネルとスレッドに近い見た目にしている。
//   /activities       …… 公開された活動が、最後の書き込みの新しい順に並ぶ
//   /activities/<id>  …… 1 本の活動（最初の書き込みと、書き足したもの）
//   /activities/new   …… 新しい活動を書く（Discord でログインした人だけ）
//
// 書いたものはそのまま公開する（承認はしない）。画像を上げたり、Markdown の
// 下見を見たりする動きは assets/js/pages/activity.js が受け持つ。
//
// 見た目の部品（c-activity / c-editor）は、一覧とスレッドの両方で使う。
// ==========================================================================

import { ACTIVITY_LIMITS } from "./activities.js";
import { formatAgo, formatJst, layout, SITE_NAME } from "./html.js";
import { escapeHtml } from "./markdown.js";

const ACTIVITIES_TITLE = "活動";
const ACTIVITY_DESCRIPTION =
    "サーバーでの出来事や、いま進めていることを、Discord のスレッドのように書き残せます。書けるのは Discord でログインした人だけです。";

/** 画面で使う動き（下見・画像）の読み込み。フォームのあるページだけに入れる */
const ACTIVITY_SCRIPT = "/assets/js/pages/activity.js";

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

/** スレッドの 1 件（最初の書き込み・書き足したもの） */
const renderPost = ({ bodyHtml, authorName, authorIcon, createdAt, badge = "" }) =>
    `                    <li class="c-activity">
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

/** 画像を上げるボタンと、その説明 */
const renderImageTools = (inputId) => `                        <div class="c-editor__toolbar">
                            <input
                                class="u-visually-hidden"
                                id="${inputId}"
                                type="file"
                                accept="image/png,image/jpeg,image/gif,image/webp"
                                data-activity-image
                            />
                            <label class="c-button c-button--small c-button--ghost" for="${inputId}">
                                画像を追加
                            </label>
                            <span class="c-editor__hint">
                                本文にカーソルを置いてから選ぶと、その場所に入ります。貼り付け（Ctrl+V）やドラッグ＆ドロップでも追加できます。
                            </span>
                        </div>`;

/** 本文の下見。書いたとおりに公開される見た目を出す */
const renderPreview = () => `                    <div class="c-editor__preview">
                        <p class="c-editor__preview-title">下見（公開される見た目と同じです）</p>
                        <div class="c-prose" data-activity-preview></div>
                    </div>`;

/** 画像の上げ具合や、入力の間違いを知らせる場所 */
const renderEditorMessage = () =>
    `                    <p class="c-editor__message" role="status" data-activity-message hidden></p>`;

/** 活動 1 本のページ */
export const renderActivity = ({ thread, posts = [], viewer = null, error = "" }) => {
    const isAuthor = Boolean(viewer && viewer.id === thread.authorId);
    const hidden = thread.status !== "published";
    const canPost = isAuthor && !hidden;

    const messages = [
        renderPost({
            bodyHtml: thread.bodyHtml,
            authorName: thread.authorName,
            authorIcon: thread.authorIcon,
            createdAt: thread.createdAt,
            badge: "開始",
        }),
        ...posts.map((post) => renderPost(post)),
    ].join("\n");

    const notice = hidden
        ? `                <p class="p-activity__notice">
                    この活動は、運営が取り下げています。一覧には出ていません（この画面は、書いた本人と運営だけが見られます）。
                </p>`
        : "";

    const form = !isAuthor
        ? `                <p class="p-activity__note">
                    書き足せるのは、この活動を立てた本人だけです。
                </p>`
        : !canPost
          ? `                <p class="p-activity__note">
                    取り下げられている間は、書き足せません。運営に相談してください。
                </p>`
          : `                <form class="p-activity__form" method="post" action="/activities/${encodeURIComponent(thread.id)}/posts" data-activity-form>
                    <div class="p-activity__field">
                        <label class="p-activity__label" for="activity-body">書き足す</label>
                        <textarea
                            class="p-activity__textarea"
                            id="activity-body"
                            name="body"
                            rows="5"
                            maxlength="${ACTIVITY_LIMITS.body}"
                            placeholder="その後の様子や、次にやることを書き足せます。Markdown と画像が使えます。"
                            data-activity-body
                            required
                        ></textarea>
${renderImageTools("activity-post-image")}
                    </div>
${renderPreview()}
${renderEditorMessage()}
                    <p class="p-activity__actions">
                        <button class="c-button" type="submit">書き込む</button>
                        <span class="p-activity__note">書き込むと、すぐにこのページに出ます。</span>
                    </p>
                </form>`;

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
        noindex: hidden,
        scripts: canPost ? [ACTIVITY_SCRIPT] : [],
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
                        ${escapeHtml(user.name)} さんとして書きます。書いた内容は、すぐに公開されます。
                    </p>
                </div>
            </header>

            <div class="l-container l-container--narrow">
${
    error
        ? `                <p class="p-activities__error" role="alert">${escapeHtml(error)}</p>
`
        : ""
}                <form class="p-activities__form" method="post" action="/activities" data-activity-form>
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
                            placeholder="いまの状況や、次にやることなど。Markdown と画像が使えます（改行はそのまま出ます）。"
                            data-activity-body
                            required
                        >${escapeHtml(values.body)}</textarea>
${renderImageTools("activity-image")}
                        <p class="p-activities__hint">
                            見出しは <code>## 見出し</code>、太字は <code>**太字**</code>、箇条書きは行のはじめに
                            <code>-</code>。画像は 1MB まで（PNG / JPEG / GIF / WebP）です。
                        </p>
                    </div>
${renderPreview()}
${renderEditorMessage()}
                    <p class="p-activities__actions">
                        <button class="c-button" type="submit">書く</button>
                        <a class="c-button c-button--ghost" href="/activities">やめる</a>
                    </p>
                </form>
            </div>`;

    return layout({
        title: `活動を書く | ${ACTIVITIES_TITLE} | ${SITE_NAME}`,
        description: `${SITE_NAME} に活動を書きます。`,
        body,
        noindex: true,
        scripts: [ACTIVITY_SCRIPT],
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

/** 活動が見つからないとき（消えた・取り下げになった・URL 違い） */
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
