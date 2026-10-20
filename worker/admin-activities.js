// ==========================================================================
// admin-activities.js — 運営用「活動の管理」（/admin/activities）の HTML
//
// 合言葉で入った人だけが見るページ。活動は書いた時点で公開されるので、ここで
// やるのは「取り下げる」「戻す」だけ（本文は書き換えない）。取り下げた活動は
// 一覧から下がり、書いた本人と運営にだけ見える。
//
// 送信はふつうのフォーム（JavaScript を使わない）。押したら /admin/activities に
// POST して、終わったら同じページへ戻る。
//
// 見た目は assets/css/pages/admin-activities.css（p-admin-activities）にある。
// ==========================================================================

import { formatJst, layout, SITE_NAME } from "./html.js";
import { escapeHtml } from "./markdown.js";

export const ADMIN_ACTIVITIES_TITLE = "活動の管理";

/** 本文（Markdown）を、確認用の 1 つの文にする */
const toExcerpt = (markdown, limit = 240) => {
    const text = String(markdown ?? "")
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" ");

    return text.length > limit ? `${text.slice(0, limit)}…` : text;
};

/** 押したあとに出す文（?done=… と対応） */
const DONE_TEXTS = {
    "thread-hide": "活動を取り下げました。一覧から下がっています。",
    "thread-restore": "活動を戻しました。また一覧に並びます。",
};

/** 取り下げる・戻すのボタン。どちらも同じ形なので 1 か所で作る */
const renderAction = ({ id, action, label, danger = false }) => `                        <form
                            class="p-admin-activities__action"
                            method="post"
                            action="/admin/activities"
                        >
                            <input type="hidden" name="id" value="${escapeHtml(String(id))}" />
                            <input type="hidden" name="action" value="${action}" />
                            <button
                                class="c-button c-button--small${danger ? " c-button--danger" : ""}"
                                type="submit"
                            >
                                ${label}
                            </button>
                        </form>`;

/** 活動 1 本 */
const renderThread = (
    thread,
    { action, label, danger = false },
) => `                    <li class="p-admin-activities__item">
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
                        <p class="p-admin-activities__excerpt">${escapeHtml(
                            toExcerpt(thread.body_md),
                        )}</p>
                        <div class="p-admin-activities__actions">
${renderAction({ id: thread.id, action, label, danger })}
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
 *   published …… 公開中の活動（新しい順）
 *   hidden …… 取り下げた活動（新しい順）
 *   done …… 押したあとの ?done=（知らない値なら空）
 *   error …… 送られてきた内容に問題があったときの理由
 */
export const renderAdminActivities = ({ published = [], hidden = [], done = "", error = "" }) => {
    const notice = error
        ? `                    <p class="p-admin-activities__notice p-admin-activities__notice--failed" role="status">
                        ${escapeHtml(error)}
                    </p>`
        : DONE_TEXTS[done]
          ? `                    <p class="p-admin-activities__notice" role="status">
                        ${escapeHtml(DONE_TEXTS[done])}
                    </p>`
          : "";

    const body = `            <header class="c-page-header">
                <div class="l-container">
                    <p class="c-page-header__lead">運営用</p>
                    <h1 class="c-page-header__title">${ADMIN_ACTIVITIES_TITLE}</h1>
                    <p class="c-page-header__text">
                        活動は書いた時点で公開されます。問題があるものだけ、ここから取り下げてください（あとから戻せます）。
                    </p>
                </div>
            </header>

            <div class="l-container">
                <nav class="c-admin-nav" aria-label="運営のページ">
                    <a class="c-admin-nav__link" href="/admin/columns">コラムの承認</a>
                    <a class="c-admin-nav__link" href="/admin/activities" aria-current="page"
                        >活動の管理</a
                    >
                    <a class="c-admin-nav__link" href="/admin/achievements">実績の付与・剥奪</a>
                </nav>

                <div class="p-admin-activities">
${notice}
${renderSection({
    id: "admin-activities-published",
    heading: `公開中の活動（${published.length} 件）`,
    items: published.map((thread) =>
        renderThread(thread, { action: "hide", label: "取り下げる", danger: true }),
    ),
    empty: "公開中の活動はありません。",
})}
${renderSection({
    id: "admin-activities-hidden",
    heading: `取り下げた活動（${hidden.length} 件）`,
    items: hidden.map((thread) => renderThread(thread, { action: "restore", label: "戻す" })),
    empty: "取り下げた活動はありません。",
})}
                </div>
            </div>`;

    return layout({
        title: `${ADMIN_ACTIVITIES_TITLE} | ${SITE_NAME}`,
        description: `${SITE_NAME} の運営用ページです。活動の取り下げと復帰をします。`,
        noindex: true,
        body,
    });
};
