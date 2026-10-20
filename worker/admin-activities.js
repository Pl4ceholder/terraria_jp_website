// ==========================================================================
// admin-activities.js — 運営用「活動の承認」（/admin/activities）の HTML
//
// 合言葉で入った人だけが見るページ。承認待ちの活動（スレッド）と、承認待ちの
// 書き込みを、ここで公開するか見送るかを決める。公開中のものを取り下げることもできる。
//
// 送信はふつうのフォーム（JavaScript を使わない）。押したら /admin/activities に
// POST して、終わったら同じページへ戻る。
//
// 見た目は assets/css/pages/admin-activities.css（p-admin-activities）にある。
// ==========================================================================

import { formatJst, layout, SITE_NAME } from "./html.js";
import { escapeHtml } from "./markdown.js";

export const ADMIN_ACTIVITIES_TITLE = "活動の承認";

/** 一覧に出す本文の抜粋の長さ */
const EXCERPT_MAX = 240;

/** 押したあとに出す文（?done=… と対応） */
const DONE_TEXTS = {
    "thread-publish": "活動を公開しました。",
    "thread-reject": "活動を見送りました。",
    "post-publish": "書き込みを公開しました。",
    "post-reject": "書き込みを見送りました。",
};

/** 本文（Markdown）を、確認用の 1 つの文にする */
const toExcerpt = (markdown, limit = EXCERPT_MAX) => {
    const text = String(markdown ?? "")
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" ");

    return text.length > limit ? `${text.slice(0, limit)}…` : text;
};

/** 公開する・見送るのボタン。どちらも同じ形なので 1 か所で作る */
const renderAction = ({ kind, id, action, label, danger = false }) => `                        <form
                            class="p-admin-activities__action"
                            method="post"
                            action="/admin/activities"
                        >
                            <input type="hidden" name="kind" value="${kind}" />
                            <input type="hidden" name="id" value="${escapeHtml(String(id))}" />
                            <input type="hidden" name="action" value="${action}" />
                            <button
                                class="c-button c-button--small${danger ? " c-button--danger" : ""}"
                                type="submit"
                            >
                                ${label}
                            </button>
                        </form>`;

/** 承認待ちの活動 1 本 */
const renderThread = (thread) => `                    <li class="p-admin-activities__item">
                        <p class="p-admin-activities__head">
                            <span class="p-admin-activities__author">${escapeHtml(
                                thread.author_name || "名前なし",
                            )}</span>
                            <time class="p-admin-activities__time" datetime="${escapeHtml(
                                thread.created_at,
                            )}">${escapeHtml(formatJst(thread.created_at))}</time>
                        </p>
                        <h3 class="p-admin-activities__title">
                            <a
                                class="p-admin-activities__title-link"
                                href="/activities/${encodeURIComponent(thread.id)}"
                                >${escapeHtml(thread.title)}</a
                            >
                        </h3>
                        <p class="p-admin-activities__excerpt">${escapeHtml(
                            toExcerpt(thread.body_md),
                        )}</p>
                        <div class="p-admin-activities__actions">
${renderAction({ kind: "thread", id: thread.id, action: "publish", label: "公開する" })}
${renderAction({
    kind: "thread",
    id: thread.id,
    action: "reject",
    label: "見送る",
    danger: true,
})}
                        </div>
                    </li>`;

/** 承認待ちの書き込み 1 件 */
const renderPost = (post) => `                    <li class="p-admin-activities__item">
                        <p class="p-admin-activities__head">
                            <span class="p-admin-activities__author">${escapeHtml(
                                post.author_name || "名前なし",
                            )}</span>
                            <time class="p-admin-activities__time" datetime="${escapeHtml(
                                post.created_at,
                            )}">${escapeHtml(formatJst(post.created_at))}</time>
                        </p>
                        <p class="p-admin-activities__parent">
                            <a
                                class="p-admin-activities__title-link"
                                href="/activities/${encodeURIComponent(post.activity_id)}"
                                >${escapeHtml(post.title)}</a
                            >
                            への書き込み
                        </p>
                        <p class="p-admin-activities__excerpt">${escapeHtml(
                            toExcerpt(post.body_md),
                        )}</p>
                        <div class="p-admin-activities__actions">
${renderAction({ kind: "post", id: post.id, action: "publish", label: "公開する" })}
${renderAction({
    kind: "post",
    id: post.id,
    action: "reject",
    label: "見送る",
    danger: true,
})}
                        </div>
                    </li>`;

/** 公開中の活動 1 本（取り下げるため） */
const renderRecent = (thread) => `                    <li class="p-admin-activities__item">
                        <p class="p-admin-activities__head">
                            <span class="p-admin-activities__author">${escapeHtml(
                                thread.author_name || "名前なし",
                            )}</span>
                            <time class="p-admin-activities__time" datetime="${escapeHtml(
                                thread.updated_at,
                            )}">${escapeHtml(formatJst(thread.updated_at))}</time>
                        </p>
                        <h3 class="p-admin-activities__title">
                            <a
                                class="p-admin-activities__title-link"
                                href="/activities/${encodeURIComponent(thread.id)}"
                                >${escapeHtml(thread.title)}</a
                            >
                        </h3>
                        <p class="p-admin-activities__parent">${Number(
                            thread.post_count ?? 1,
                        )} 件の書き込み</p>
                        <div class="p-admin-activities__actions">
${renderAction({
    kind: "thread",
    id: thread.id,
    action: "reject",
    label: "取り下げる",
    danger: true,
})}
                        </div>
                    </li>`;

/** 節（見出し + 一覧）。空のときは、その旨を出す */
const renderSection = ({
    id,
    heading,
    items,
    empty,
}) => `                <section class="p-admin-activities__section" aria-labelledby="${id}">
                    <h2 class="p-admin-activities__heading" id="${id}">${heading}</h2>${
                        items.length > 0
                            ? `
                    <ul class="p-admin-activities__items">
${items.join("\n")}
                    </ul>`
                            : `
                    <p class="p-admin-activities__empty">${empty}</p>`
                    }
                </section>`;

/**
 * ページ全体。
 *
 *   threads …… 承認待ちの活動
 *   posts …… 承認待ちの書き込み
 *   recent …… 公開中の活動（新しい順）
 *   done …… 押したあとの ?done=（知らない値なら空）
 *   error …… 送られてきた内容に問題があったときの理由
 */
export const renderAdminActivities = ({
    threads = [],
    posts = [],
    recent = [],
    done = "",
    error = "",
}) => {
    const notice = error
        ? `                    <p class="p-admin-activities__notice p-admin-activities__notice--failed" role="status">
                        ${escapeHtml(error)}
                    </p>`
        : DONE_TEXTS[done]
          ? `                    <p class="p-admin-activities__notice" role="status">
                        ${escapeHtml(DONE_TEXTS[done])}
                    </p>`
          : "";

    const waiting = threads.length + posts.length;

    const body = `            <header class="c-page-header">
                <div class="l-container">
                    <p class="c-page-header__lead">運営用</p>
                    <h1 class="c-page-header__title">${ADMIN_ACTIVITIES_TITLE}</h1>
                    <p class="c-page-header__text">
                        承認すると活動ページに出ます。見送っても、あとから公開できます。承認待ちは ${waiting} 件です。
                    </p>
                </div>
            </header>

            <div class="l-container">
                <nav class="c-admin-nav" aria-label="運営のページ">
                    <a class="c-admin-nav__link" href="/admin/columns">コラムの承認</a>
                    <a class="c-admin-nav__link" href="/admin/activities" aria-current="page"
                        >活動の承認</a
                    >
                    <a class="c-admin-nav__link" href="/admin/achievements">実績の付与・剥奪</a>
                </nav>

                <div class="p-admin-activities">
${notice}
${renderSection({
    id: "admin-activities-threads",
    heading: `承認待ちの活動（${threads.length} 件）`,
    items: threads.map(renderThread),
    empty: "承認待ちの活動はありません。",
})}
${renderSection({
    id: "admin-activities-posts",
    heading: `承認待ちの書き込み（${posts.length} 件）`,
    items: posts.map(renderPost),
    empty: "承認待ちの書き込みはありません。",
})}
${renderSection({
    id: "admin-activities-recent",
    heading: "公開中の活動",
    items: recent.map(renderRecent),
    empty: "公開中の活動はありません。",
})}
                </div>
            </div>`;

    return layout({
        title: `${ADMIN_ACTIVITIES_TITLE} | ${SITE_NAME}`,
        description: `${SITE_NAME} の運営用ページです。投稿された活動を承認します。`,
        noindex: true,
        body,
    });
};
