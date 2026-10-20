// ==========================================================================
// requests.js — Web からの「実績の付与・剥奪」と「称号の着脱」の依頼
//
// サイトは Discord を触らない。ここで依頼を D1 に 1 行置くだけで、bot が 30 秒ごとに
// 拾って Discord に反映し、結果を書き戻す（bot 側は cogs/sync.py）。
//
// 依頼の中身の確かめ方と、SQL を 1 か所に置いているのは、手元で確かめるため。
// scripts/check-requests.mjs が、そのまま読んで試す。
//
// 依頼には期限（REQUEST_TTL_MINUTES）がある。bot が止まっている間に古くなった
// 「称号を着ける」を、あとから当てないため。
// ==========================================================================

/** 依頼を置いてから、これを過ぎたものは捨てる（分） */
export const REQUEST_TTL_MINUTES = 10;

/** bot が 1 回で受け取る依頼の数 */
export const REQUEST_LIST_MAX = 20;

/** 画面に出す理由の長さ（bot が書く） */
export const REQUEST_MESSAGE_MAX = 300;

/** 種類と、その種類で使える操作 */
export const REQUEST_ACTIONS = {
    // 称号の着脱（マイページ）
    title: ["set", "clear"],
    // 実績の付与・剥奪（管理画面）
    unlock: ["grant", "revoke"],
};

/** bot が書き戻す結果 */
export const RESULT_STATUSES = ["done", "failed", "expired"];

/** 依頼を出した人（画面の出し分けに使う） */
export const REQUEST_SOURCES = ["mypage", "admin"];

/** Discord の ID か（スノーフレーク。いまは 19 桁だが、余裕をもたせる） */
export const isSnowflake = (value) => /^\d{17,20}$/.test(String(value ?? "").trim());

/**
 * 入力から Discord のユーザー ID を取り出す。
 *
 * 手で貼り付けるときは `<@123>` `<@!123>` の形にもなるので、それも受ける。
 * 取り出せなければ空文字（呼ぶ側は、それで断る）。
 */
export const parseUserId = (value) => {
    const text = String(value ?? "").trim();
    const mention = text.match(/^<@!?(\d{17,20})>$/);
    if (mention) return mention[1];

    return isSnowflake(text) ? text : "";
};

/**
 * 依頼を、保存できる形に整える。
 *
 *   { kind, action, userId, roleId, source }
 *
 * 知らない種類・操作、ユーザー ID でないものは断る。称号を外すとき（clear）だけは
 * ロール ID を持たない。
 */
export const toRequest = (payload) => {
    const kind = trimTo(payload?.kind, 16);
    const actions = REQUEST_ACTIONS[kind];
    if (!actions) return { error: "知らない種類の依頼です。" };

    const action = trimTo(payload?.action, 16);
    if (!actions.includes(action)) return { error: "知らない操作です。" };

    const userId = parseUserId(payload?.userId);
    if (!userId) return { error: "Discord のユーザー ID が正しくありません。" };

    const source = trimTo(payload?.source, 16);
    if (!REQUEST_SOURCES.includes(source)) return { error: "依頼の出どころが正しくありません。" };

    let roleId = "";
    if (action !== "clear") {
        roleId = trimTo(payload?.roleId, 32);
        if (!isSnowflake(roleId)) return { error: "実績の ID が正しくありません。" };
    }

    return { data: { kind, action, userId, roleId, source } };
};

/**
 * bot が書き戻す結果を、保存できる形に整える。
 *
 *   { status: "done" | "failed" | "expired", message }
 *
 * 失敗したときは理由を必ず書かせる（画面にそのまま出すため）。
 */
export const toResult = (payload) => {
    const status = trimTo(payload?.status, 16);
    if (!RESULT_STATUSES.includes(status)) return { error: "知らない結果です。" };

    const message = trimTo(payload?.message, REQUEST_MESSAGE_MAX);
    if (status !== "done" && !message) return { error: "失敗した理由が入っていません。" };

    return { data: { status, message } };
};

/** 依頼が古すぎるか（bot は古いものを当てずに expired にする） */
export const isExpired = (requestedAt, now, minutes = REQUEST_TTL_MINUTES) => {
    const time = Date.parse(requestedAt);
    if (!Number.isFinite(time)) return true;

    return now - time > minutes * 60 * 1000;
};

/** bot に渡す形（DB の列名を、そのまま送る形に変える） */
export const toRequestList = (rows) =>
    (rows ?? []).map((row) => ({
        id: row.id,
        kind: row.kind,
        action: row.action,
        userId: row.user_id,
        roleId: row.role_id ?? "",
        requestedAt: row.requested_at,
    }));

/** 画面に出す 1 件（依頼が無ければ null） */
export const toRequestView = (row) =>
    row
        ? {
              id: row.id,
              kind: row.kind,
              action: row.action,
              roleId: row.role_id ?? "",
              status: row.status,
              message: row.message ?? "",
              requestedAt: row.requested_at ?? "",
              finishedAt: row.finished_at ?? "",
          }
        : null;

/** 依頼を 1 件置く */
export const REQUEST_INSERT_SQL = `
    INSERT INTO achievement_requests (kind, action, user_id, role_id, source, requested_at, status)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending')
`;

/** bot が拾う、まだ処理していない依頼（古い順） */
export const REQUEST_PENDING_SQL = `
    SELECT id, kind, action, user_id, role_id, requested_at
      FROM achievement_requests
     WHERE status = 'pending'
     ORDER BY id
     LIMIT ?1
`;

/** その人の、まだ処理していない依頼（種類ごと） */
export const REQUEST_PENDING_FOR_USER_SQL = `
    SELECT id, kind, action, user_id, role_id, requested_at
      FROM achievement_requests
     WHERE status = 'pending' AND user_id = ?1 AND kind = ?2
     ORDER BY id
`;

/** その人の、まだ処理していない依頼（種類を問わず。管理画面で使う） */
export const REQUEST_PENDING_ANY_SQL = `
    SELECT id, kind, action, user_id, role_id, requested_at
      FROM achievement_requests
     WHERE status = 'pending' AND user_id = ?1
     ORDER BY id
     LIMIT 1
`;

/** 同じ依頼がすでに待っていないか（ボタンを二度押しされたとき用） */
export const REQUEST_DUPLICATE_SQL = `
    SELECT id
      FROM achievement_requests
     WHERE status = 'pending' AND user_id = ?1 AND role_id = ?2 AND action = ?3
     LIMIT 1
`;

/** その人の最後の結果（画面に出すため） */
export const REQUEST_LAST_FOR_USER_SQL = `
    SELECT id, kind, action, role_id, status, message, requested_at, finished_at
      FROM achievement_requests
     WHERE user_id = ?1 AND kind = ?2 AND status <> 'pending'
     ORDER BY id DESC
     LIMIT 1
`;

/** bot の結果を書き戻す（処理済みのものは上書きしない） */
export const REQUEST_FINISH_SQL = `
    UPDATE achievement_requests
       SET status = ?1, finished_at = ?2, message = ?3
     WHERE id = ?4 AND status = 'pending'
`;

/** 古い依頼を片付ける（bot が実績を送るついでに流す） */
export const REQUEST_CLEANUP_SQL = `
    DELETE FROM achievement_requests
     WHERE status <> 'pending' AND requested_at < ?1
`;

/** 文字列を、長さを切って整える */
const trimTo = (value, max) =>
    String(value ?? "")
        .trim()
        .slice(0, max);
