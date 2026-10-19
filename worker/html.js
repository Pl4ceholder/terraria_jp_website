// ==========================================================================
// html.js — コラムのページ（一覧・記事）を組み立てる
//
// 形は手書きのページ（news.html など）に合わせる。共通ヘッダ・フッターは
// Web Component なので、ここでは読み込むだけ。
//
// ここで作るページは Worker が返すので、素材の場所は「サイトのルート」から
// 書ける（/assets/... のように）。下の階層かどうかを気にしなくてよい。
// ==========================================================================

import { buildExcerpt, escapeHtml } from "./markdown.js";

export const SITE_NAME = "Terraria JP";
export const COLUMNS_TITLE = "コラム";

/** ページの外側（<head> と共通パーツ） */
export const layout = ({ title, description, body }) => `<!doctype html>
<html lang="ja">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${escapeHtml(title)}</title>
        <meta name="description" content="${escapeHtml(description)}" />
        <link rel="stylesheet" href="/assets/css/style.css" />
    </head>

    <body>
        <!-- 共通ヘッダ（assets/js/components/site-header.js） -->
        <x-site-header></x-site-header>

        <main class="l-main">
${body}
        </main>

        <!-- 共通フッター（assets/js/components/site-footer.js） -->
        <x-site-footer></x-site-footer>

        <script src="/assets/js/components/site-header.js" defer></script>
        <script src="/assets/js/components/site-footer.js" defer></script>
    </body>
</html>
`;

/** 日付（2026-10-19）を表示用（2026.10.19）にする */
export const formatDate = (isoDate) => String(isoDate).replaceAll("-", ".");

/** 日本時間（UTC+9、夏時間なし）の「2026.10.19 21:00」にする */
export const formatJst = (iso) => {
    const time = Date.parse(iso);
    if (!Number.isFinite(time)) return "";

    const jst = new Date(time + 9 * 60 * 60 * 1000);
    const pad = (value) => String(value).padStart(2, "0");

    return [
        `${jst.getUTCFullYear()}.${pad(jst.getUTCMonth() + 1)}.${pad(jst.getUTCDate())}`,
        `${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`,
    ].join(" ");
};

/** 「3 時間前」のように、いまからどれくらい前かを表す */
export const formatAgo = (iso, now) => {
    const time = Date.parse(iso);
    if (!Number.isFinite(time)) return "";

    const minutes = Math.floor((now - time) / 60000);
    if (minutes < 1) return "たった今";
    if (minutes < 60) return `${minutes} 分前`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 時間前`;

    return `${Math.floor(hours / 24)} 日前`;
};

/** 記事 1 件のページ */
export const renderArticle = (column) => {
    const meta = [
        column.author ? escapeHtml(column.author) : "",
        column.tags.length > 0 ? `タグ: ${column.tags.map(escapeHtml).join(", ")}` : "",
    ]
        .filter(Boolean)
        .join(" ・ ");

    const body = `            <header class="c-page-header">
                <div class="l-container l-container--narrow">
                    <p class="c-page-header__lead">
                        <time datetime="${column.date}">${formatDate(column.date)}</time>
                    </p>
                    <h1 class="c-page-header__title">${escapeHtml(column.title)}</h1>${
                        meta
                            ? `\n                    <p class="c-page-header__text">${meta}</p>`
                            : ""
                    }
                </div>
            </header>

            <div class="l-container l-container--narrow">
                <article class="c-prose">
${column.html}
                </article>
            </div>`;

    return layout({
        title: `${column.title} | ${COLUMNS_TITLE} | ${SITE_NAME}`,
        description: buildExcerpt(column.body) || `${column.title}（${SITE_NAME} のコラム）`,
        body,
    });
};

/** 記事の一覧のページ */
export const renderList = (columns) => {
    const items = columns
        .map((column) => {
            const author = column.author
                ? `
                            <span class="p-columns-list__author">${escapeHtml(column.author)}</span>`
                : "";

            return `                    <li class="p-columns-list__item">
                        <a class="p-columns-list__link" href="/columns/${encodeURIComponent(column.slug)}.html">
                            <time class="p-columns-list__date" datetime="${column.date}">${formatDate(column.date)}</time>
                            <span class="p-columns-list__title">${escapeHtml(column.title)}</span>${author}
                        </a>
                    </li>`;
        })
        .join("\n");

    const list =
        columns.length > 0
            ? `                <ul class="p-columns-list">
${items}
                </ul>`
            : `                <p>まだコラムはありません。</p>`;

    const body = `            <header class="c-page-header">
                <div class="l-container l-container--narrow">
                    <p class="c-page-header__lead">${SITE_NAME} のコラム</p>
                    <h1 class="c-page-header__title">${COLUMNS_TITLE}</h1>
                    <p class="c-page-header__text">
                        Terraria の遊び方や、サーバーでの出来事を書いた読み物です。誰でも書けます。
                    </p>
                    <p class="c-page-header__actions">
                        <a class="c-button" href="/post">コラムを書く</a>
                    </p>
                </div>
            </header>

            <div class="l-container l-container--narrow">
${list}
            </div>`;

    return layout({
        title: `${COLUMNS_TITLE} | ${SITE_NAME}`,
        description: `${SITE_NAME} のコラム（Terraria の読み物）の一覧です。`,
        body,
    });
};

/** 見つからなかったときのページ */
export const renderNotFound = () =>
    layout({
        title: `ページが見つかりません | ${SITE_NAME}`,
        description: "お探しのページは見つかりませんでした。",
        body: `            <header class="c-page-header">
                <div class="l-container l-container--narrow">
                    <p class="c-page-header__lead">404</p>
                    <h1 class="c-page-header__title">ページが見つかりません</h1>
                    <p class="c-page-header__text">
                        記事が消えているか、公開が取り消されたかもしれません。
                    </p>
                    <p class="c-page-header__actions">
                        <a class="c-button" href="/columns.html">コラムの一覧へ</a>
                    </p>
                </div>
            </header>`,
    });
