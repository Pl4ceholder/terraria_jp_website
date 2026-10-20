// ==========================================================================
// admin-achievements.js — 運営用「実績の付与・剥奪」（/admin/achievements）の HTML
//
// 合言葉で入った人だけが見るページ。付与・剥奪はここから Discord を触らず、依頼を
// 1 行置くだけ（POST /admin/achievements）。bot が 30 秒ごとに拾って反映する。
//
// 一覧に出すのは、bot から届いた写しのうち実績を 1 つ以上持っている人。まだ何も
// 持っていない人へは、Discord の ID を入れて直接付与できる。
//
// 見た目は assets/css/pages/admin-achievements.css（p-admin-achievements）にある。
// ==========================================================================

import { escapeHtml } from "./markdown.js";
import { layout, SITE_NAME } from "./html.js";

export const ADMIN_ACHIEVEMENTS_TITLE = "実績の付与・剥奪";

/** 反映を待っている間、この秒数で画面を読み直す（javascript を使わずに済ませる） */
const REFRESH_SECONDS = 5;

/** 結果を出しておく時間（分）。過ぎたら消す */
const NOTICE_MINUTES = 10;

/** 反映中の依頼を、短い日本語にする */
const ACTION_TEXTS = {
    set: "称号を付けています。",
    clear: "称号を外しています。",
    grant: "実績を付与しています。",
    revoke: "実績を剥奪しています。",
};

/** 反映待ちと、直前の結果 */
const renderNotice = ({ pending, result, now }) => {
    if (pending) {
        return `                    <p class="p-admin-achievements__notice" role="status">
                        ${escapeHtml(ACTION_TEXTS[pending.action] ?? "反映しています。")}30 秒ほどで反映されます（この画面は自動で更新します）。
                    </p>`;
    }

    if (!result?.finishedAt) return "";
    if (now - Date.parse(result.finishedAt) > NOTICE_MINUTES * 60 * 1000) return "";

    const done = result.status === "done";
    const message = result.message || (done ? "反映しました。" : "反映できませんでした。");

    return `                    <p class="p-admin-achievements__notice p-admin-achievements__notice--${
        done ? "done" : "failed"
    }" role="status">
                        ${escapeHtml(message)}
                    </p>`;
};

/** 送られてきた内容に問題があったとき（ふつうは起きない） */
const renderError = (message) =>
    `                    <p class="p-admin-achievements__notice p-admin-achievements__notice--failed" role="status">
                        ${escapeHtml(message)}
                    </p>`;

/** 解放している数（カンマでつないだ文字列から数える） */
const countOf = (unlocked) =>
    String(unlocked ?? "")
        .split(",")
        .filter(Boolean).length;

/** 相手を選ぶ一覧（実績を持っている人だけ） */
const renderMembers = (members) => {
    if (members.length === 0) {
        return `                    <p class="p-admin-achievements__empty">
                        実績を持っている人が、まだ登録されていません。上の欄に Discord の ID を入れると、直接付与できます。
                    </p>`;
    }

    const items = members
        .map((member) => {
            const name = escapeHtml(member.name || "（名前はまだ届いていません）");
            const worn = member.title ? "・称号あり" : "";

            return `                        <li class="p-admin-achievements__member">
                            <a class="p-admin-achievements__member-link" href="/admin/achievements?user=${escapeHtml(
                                member.user_id,
                            )}">
                                <span class="p-admin-achievements__member-name">${name}</span>
                                <span class="p-admin-achievements__member-meta"
                                    >実績 ${countOf(member.unlocked)} 件${worn}</span
                                >
                            </a>
                        </li>`;
        })
        .join("\n");

    return `                    <ul class="p-admin-achievements__members">
${items}
                    </ul>`;
};

/** 選んだ相手の実績。1 件ずつ、付与か剥奪のボタンを出す */
const renderRows = ({ userId, rows, waiting }) => {
    if (rows.length === 0) {
        return `                    <p class="p-admin-achievements__empty">
                        実績がまだ届いていません。Discord 側で実績（ロール）を用意すると、ここに出ます。
                    </p>`;
    }

    const items = rows
        .map((row) => {
            const unlocked = Number(row.unlocked) === 1;
            const state = unlocked
                ? `
                            <span class="p-admin-achievements__state">解放済み</span>`
                : "";
            const worn =
                Number(row.worn) === 1
                    ? `
                            <span class="p-admin-achievements__state p-admin-achievements__state--worn"
                                >装着中</span
                            >`
                    : "";
            const action = unlocked ? "revoke" : "grant";
            const label = unlocked ? "剥奪" : "付与";

            return `                        <li class="p-admin-achievements__row">
                            <span class="p-admin-achievements__achievement">${escapeHtml(
                                row.name || "名前なし",
                            )}</span>${state}${worn}
                            <form
                                class="p-admin-achievements__action"
                                method="post"
                                action="/admin/achievements"
                            >
                                <input type="hidden" name="user_id" value="${escapeHtml(userId)}" />
                                <input type="hidden" name="role_id" value="${escapeHtml(row.id)}" />
                                <input type="hidden" name="action" value="${action}" />
                                <button
                                    class="c-button c-button--small${unlocked ? " c-button--danger" : ""}"
                                    type="submit"${waiting ? " disabled" : ""}
                                >
                                    ${label}
                                </button>
                            </form>
                        </li>`;
        })
        .join("\n");

    return `                    <ul class="p-admin-achievements__rows">
${items}
                    </ul>`;
};

/** 選んだ相手の見出し（名前・ID・いまの称号） */
const renderMemberHeader = ({ member, userId, rows }) => {
    const name = escapeHtml(member?.name || "（名前はまだ届いていません）");
    const worn = rows.find((row) => Number(row.worn) === 1)?.name;
    const title = worn ? `いまの称号: ${escapeHtml(worn)}` : "いま称号にしているものはありません";

    return `                    <section class="p-admin-achievements__member-card">
                        <h2 class="p-admin-achievements__member-heading">${name}</h2>
                        <p class="p-admin-achievements__member-id">Discord の ID: ${escapeHtml(userId)}</p>
                        <p class="p-admin-achievements__member-title">${title}</p>
                        <p class="p-admin-achievements__member-back">
                            <a class="p-admin-achievements__link" href="/admin/achievements">相手を選び直す</a>
                        </p>
                    </section>`;
};

/**
 * ページ全体。
 *
 *   query …… 検索欄に入っていた文字（開き直したときに残す）
 *   userId …… 選んだ相手（空なら、相手を選ぶ一覧を出す）
 *   member …… 選んだ相手の保存されている行（いなければ null）
 *   rows …… 選んだ相手から見た実績の一覧（master の並び）
 *   members …… 相手を選ぶ一覧
 *   pending …… その人の反映待ちの依頼（無ければ null）
 *   result …… その人の直前の結果（無ければ null）
 *   error …… 送られてきた内容に問題があったときの理由（無ければ空）
 */
export const renderAdminAchievements = ({
    query = "",
    userId = "",
    member = null,
    rows = [],
    members = [],
    pending = null,
    result = null,
    error = "",
    now = Date.now(),
}) => {
    const waiting = pending !== null;
    const detail = userId
        ? `${renderMemberHeader({ member, userId, rows })}
${renderRows({ userId, rows, waiting })}`
        : renderMembers(members);

    const body = `            <header class="c-page-header">
                <div class="l-container">
                    <p class="c-page-header__lead">運営用</p>
                    <h1 class="c-page-header__title">${ADMIN_ACHIEVEMENTS_TITLE}</h1>
                    <p class="c-page-header__text">
                        Discord の実績を、相手ごとに付与・剥奪します。反映は bot が 30 秒ごとに行います。
                    </p>
                </div>
            </header>

            <div class="l-container">
                <nav class="c-admin-nav" aria-label="運営のページ">
                    <a class="c-admin-nav__link" href="/admin/columns">コラムの承認</a>
                    <a class="c-admin-nav__link" href="/admin/activities">活動の管理</a>
                    <a class="c-admin-nav__link" href="/admin/achievements" aria-current="page"
                        >実績の付与・剥奪</a
                    >
                </nav>

                <div class="p-admin-achievements">
                    <form class="p-admin-achievements__search" method="get" action="/admin/achievements">
                        <label class="p-admin-achievements__label" for="admin-achievement-user"
                            >相手</label
                        >
                        <input
                            class="p-admin-achievements__input"
                            id="admin-achievement-user"
                            name="q"
                            type="text"
                            value="${escapeHtml(query)}"
                            placeholder="Discord の ID か、名前の一部"
                        />
                        <button class="c-button c-button--small" type="submit">開く</button>
                        <p class="p-admin-achievements__hint">
                            Discord の ID（またはメンション）を入れると、その人を直接開きます。名前の一部なら、その人が出てきます。
                        </p>
                    </form>

${error ? renderError(error) : renderNotice({ pending, result, now })}
${detail}
                </div>
            </div>`;

    return layout({
        title: `${ADMIN_ACHIEVEMENTS_TITLE} | ${SITE_NAME}`,
        description: `${SITE_NAME} の運営用ページです。Discord の実績を付与・剥奪します。`,
        noindex: true,
        // 反映待ちの間だけ、勝手に読み直す
        refreshSeconds: waiting ? REFRESH_SECONDS : 0,
        body,
    });
};
