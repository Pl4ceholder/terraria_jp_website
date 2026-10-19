// ==========================================================================
// recruit.js — マルチ募集のページ（/recruit）を組み立てる
//
// 中身は Discord の bot から届く（POST /api/internal/recruitments）。
// ここは、D1 に入っている最新の一覧をページの形にするだけ。
//
// 募集は Discord では「メッセージ＋スレッド」で、24 時間で自動的に流れる。
// そのため、ここに出るのは「いま立っているもの」だけになる。
//
// 見た目は assets/css/pages/recruit.css（p-recruit）にある。
// ==========================================================================

import { escapeHtml } from "./markdown.js";
import { layout, SITE_NAME } from "./html.js";

export const RECRUIT_TITLE = "マルチ募集";

/** 最終更新から、この分数を過ぎたら「古いかもしれない」と伝える */
const STALE_MINUTES = 30;

/** Discord のスレッドへのリンク。ログインしていなくても、開くと Discord が立ち上がる */
const threadUrl = (guildId, id) => `https://discord.com/channels/${guildId}/${id}`;

/** 日本時間（UTC+9、夏時間なし）の「2026.10.19 21:00」にする */
const formatJst = (iso) => {
    const time = Date.parse(iso);
    if (!Number.isFinite(time)) return "";

    const jst = new Date(time + 9 * 60 * 60 * 1000);
    const pad = (value) => String(value).padStart(2, "0");

    return [
        `${jst.getUTCFullYear()}.${pad(jst.getUTCMonth() + 1)}.${pad(jst.getUTCDate())}`,
        `${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`,
    ].join(" ");
};

/** 「3 時間前」のように、いまからどれくらい前に立てられたかを表す */
const formatAgo = (iso, now) => {
    const time = Date.parse(iso);
    if (!Number.isFinite(time)) return "";

    const minutes = Math.floor((now - time) / 60000);
    if (minutes < 1) return "たった今";
    if (minutes < 60) return `${minutes} 分前`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} 時間前`;

    return `${Math.floor(hours / 24)} 日前`;
};

/** 募集 1 件のカード */
const renderItem = (recruit, now) => {
    const badges = [recruit.mode, recruit.platform, recruit.vc]
        .filter(Boolean)
        .map(
            (label, index) =>
                `<span class="p-recruit__badge${index === 0 ? " p-recruit__badge--mode" : ""}">${escapeHtml(label)}</span>`,
        )
        .join("\n                            ");

    const icon = recruit.authorIcon
        ? `<img
                                class="p-recruit__icon"
                                src="${escapeHtml(recruit.authorIcon)}"
                                alt=""
                                width="28"
                                height="28"
                                loading="lazy"
                            />`
        : "";

    const connection = recruit.connection
        ? `
                            <dt>接続</dt>
                            <dd class="p-recruit__connection">${escapeHtml(recruit.connection)}</dd>`
        : "";

    return `                    <li class="p-recruit__item">
                        <p class="p-recruit__badges">
                            ${badges}
                        </p>
                        <p class="p-recruit__author">
                            ${icon}
                            <span class="p-recruit__author-name">${escapeHtml(recruit.authorName || "名前なし")}</span>
                            <span class="p-recruit__ago">${escapeHtml(formatAgo(recruit.startedAt, now))}</span>
                        </p>
                        <p class="p-recruit__message">${escapeHtml(recruit.message)}</p>
                        <dl class="p-recruit__meta">
                            <dt>開始</dt>
                            <dd>
                                <time datetime="${escapeHtml(recruit.startedAt)}">${escapeHtml(formatJst(recruit.startedAt))}</time>
                            </dd>${connection}
                        </dl>
                        <p class="p-recruit__actions">
                            <a
                                class="c-button c-button--small"
                                href="${escapeHtml(threadUrl(recruit.guildId, recruit.id))}"
                                target="_blank"
                                rel="noopener noreferrer"
                                >Discord で開く</a
                            >
                        </p>
                    </li>`;
};

/** 最終更新の案内。古くなっていたら、そのことも伝える */
const renderUpdated = (syncedAt, now) => {
    if (!syncedAt) return "";

    const minutes = Math.floor((now - Date.parse(syncedAt)) / 60000);
    const stale = !Number.isFinite(minutes) || minutes >= STALE_MINUTES;

    return `                <p class="p-recruit__updated">
                    最終更新: ${escapeHtml(formatJst(syncedAt))}（${escapeHtml(formatAgo(syncedAt, now))}）${
                        stale
                            ? `
                    <br />
                    <span class="p-recruit__warning"
                        >Discord 側の更新が止まっているかもしれません。表示は少し古い可能性があります。</span
                    >`
                            : ""
                    }
                </p>

`;
};

/** 募集の一覧のページ */
export const renderRecruitList = (recruits, syncedAt, now = Date.now()) => {
    const list =
        recruits.length > 0
            ? `                <ul class="p-recruit__list">
${recruits.map((recruit) => renderItem(recruit, now)).join("\n")}
                </ul>`
            : `                <p class="p-recruit__empty">
                    いま立っている募集はありません。Discord の「募集を開始する」から立てられます。
                </p>`;

    const body = `            <header class="c-page-header">
                <div class="l-container l-container--narrow">
                    <p class="c-page-header__lead">${SITE_NAME} の Discord</p>
                    <h1 class="c-page-header__title">${RECRUIT_TITLE}</h1>
                    <p class="c-page-header__text">
                        Discord に立てられたマルチ募集を、ここから見られます。参加したいときは
                        Discord で声をかけてください。募集は 24 時間ほどで流れます。
                    </p>
                </div>
            </header>

            <div class="l-container">
${renderUpdated(syncedAt, now)}                <div class="p-recruit">
${list}
                </div>
            </div>`;

    return layout({
        title: `${RECRUIT_TITLE} | ${SITE_NAME}`,
        description: `${SITE_NAME} の Discord で募集中のマルチ募集の一覧です。`,
        body,
    });
};
