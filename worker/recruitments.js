// ==========================================================================
// recruitments.js — 「いま立っている募集」を選ぶ条件と、流れる時刻の求め方
//
// Discord の募集は「メッセージ＋スレッド」で、最後の書き込みから一定時間（普通は
// 1440 分＝24 時間）たつと、Discord 側で自動的に流れる。
//
// そのため「まだ生きている募集」かどうかは、最後の書き込みの時刻から決まる。
// ここで求めた時刻を保存しておき、ページはそれを今と比べるだけにする。bot が止まっても、
// 流れる時刻を過ぎた募集がいつまでも出たままにならない。
//
// 求め方も抽出の条件も、この 1 か所にだけ書く。動く側（index.js）と、手元で確かめる
// 道具（scripts/check-recruit.mjs）が同じものを読む。
// ==========================================================================

/** Discord の既定。最後の書き込みから 24 時間で流れる */
export const DEFAULT_ARCHIVE_MINUTES = 1440;

/** 流れる時刻を過ぎても、これだけは出しておく（bot の次の知らせを待つ猶予） */
export const RECRUIT_GRACE_MINUTES = 60;

/**
 * その募集が Discord から流れる時刻を求める（ISO 8601、UTC）。
 *
 * 最後の書き込みの時刻から、Discord の設定（分）だけ後。どちらかが分からないときは、
 * 立てた時刻から既定の 24 時間後にしておく（分からないものは消さない）。
 */
export const deadlineOf = (row) => {
    const base = Date.parse(row?.lastActivityAt || row?.startedAt || "");
    if (!Number.isFinite(base)) return "";

    const minutes = Number(row?.archiveMinutes);
    const span = Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_ARCHIVE_MINUTES;

    return new Date(base + span * 60 * 1000).toISOString();
};

/**
 * まだ生きている募集を、新しい順に引く。
 *
 *   ?1 …… 猶予の境目（いま − 猶予の分）
 *   ?2 …… 一度に出す上限
 *
 * 流れる時刻が分からないものは、判断できないので出す。
 */
export const RECRUIT_LIST_SQL = `
    SELECT id, guild_id, mode, platform, vc, message,
           author_name, author_icon, started_at, last_activity_at, message_count, deadline_at
      FROM recruitments
     WHERE deadline_at IS NULL OR deadline_at >= ?1
     ORDER BY started_at DESC
     LIMIT ?2
`;

/** 流れる時刻を過ぎて、出していない募集の数（ページに「N 件は出していません」と書く） */
export const RECRUIT_HIDDEN_SQL = `
    SELECT COUNT(*) AS hidden
      FROM recruitments
     WHERE deadline_at IS NOT NULL AND deadline_at < ?1
`;
