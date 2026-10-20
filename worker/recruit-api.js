// ==========================================================================
// recruit-api.js — マルチ募集（Discord の写し）の受け取りと表示
//
// 募集の持ち主は Discord 側。bot が届いた内容で丸ごと入れ替えるので、何度
// 届いても同じ結果になり、途中で切れても中途半端な一覧は残らない。
//
// 接続方法（SteamID / IP:Port）は個人情報になるため、受け取っても保存しない。
// ==========================================================================

import { htmlResponse, jsonResponse, methodNotAllowed, readJson } from "./http.js";
import { renderRecruitList } from "./recruit.js";
import {
    deadlineOf,
    RECRUIT_GRACE_MINUTES,
    RECRUIT_HIDDEN_SQL,
    RECRUIT_LIST_SQL,
} from "./recruitments.js";
import { checkSyncSecret } from "./sync.js";
import { toCount, toIso, trimTo } from "./values.js";

const RECRUIT_SYNC_MAX_BYTES = 256 * 1024;
const RECRUIT_MAX = 100;
const RECRUIT_MESSAGE_MAX = 1000;

/**
 * Discord の bot から、いま立っている募集の一覧を受け取る。
 *
 * 募集の持ち主は Discord 側なので、届いた内容で丸ごと入れ替える。
 * 何度届いても同じ結果になり、途中で切れても中途半端な一覧は残らない。
 */
export const handleRecruitSync = async (request, env) => {
    if (request.method !== "POST") return methodNotAllowed("POST");

    const denied = checkSyncSecret(request, env);
    if (denied) return denied;

    const payload = await readJson(request, RECRUIT_SYNC_MAX_BYTES);
    if (payload.error) return payload.error;

    const now = new Date().toISOString();
    const rows = toRecruitRows(payload.data, now);
    if (rows.error) return jsonResponse({ ok: false, message: rows.error }, 400);

    await env.DB.batch([
        env.DB.prepare(`DELETE FROM recruitments`),
        ...rows.data.map((row) =>
            env.DB.prepare(
                `INSERT INTO recruitments
                     (id, guild_id, channel_id, message_id, mode, platform, vc,
                      message, author_id, author_name, author_icon, started_at,
                      last_activity_at, message_count, archive_minutes, deadline_at, synced_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                         ?11, ?12, ?13, ?14, ?15, ?16, ?17)`,
            ).bind(
                row.id,
                row.guildId,
                row.channelId,
                row.messageId,
                row.mode,
                row.platform,
                row.vc,
                row.message,
                row.authorId,
                row.authorName,
                row.authorIcon,
                row.startedAt,
                row.lastActivityAt,
                row.messageCount,
                row.archiveMinutes,
                row.deadlineAt,
                row.syncedAt,
            ),
        ),
        // 1 件も無いときでも「最後にいつ届いたか」を出せるように残す
        env.DB.prepare(
            `INSERT INTO sync_state (key, value) VALUES ('recruitments_synced_at', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        ).bind(now),
    ]);

    return jsonResponse({ ok: true, count: rows.data.length });
};

/** Discord から届いた内容を、保存できる形に整える。おかしければメッセージを返す */
const toRecruitRows = (payload, syncedAt) => {
    const list = Array.isArray(payload?.recruitments) ? payload.recruitments : null;
    if (!list) return { error: "募集の一覧が入っていません。" };

    const guildId = trimTo(payload?.guildId, 32);
    if (!guildId) return { error: "Discord のサーバー ID が入っていません。" };
    if (list.length > RECRUIT_MAX) return { error: `募集は一度に ${RECRUIT_MAX} 件までです。` };

    const data = [];
    const seen = new Set();

    for (const item of list) {
        const id = trimTo(item?.id, 32);
        // スレッド ID が無いものは Discord で辿れないので、出さない
        if (!id || seen.has(id)) continue;
        seen.add(id);

        const startedAt = toIso(item?.startedAt, syncedAt);
        // 最後の書き込みが分からなければ、立てた時刻と同じにする
        const lastActivityAt = toIso(item?.lastActivityAt, startedAt);
        const archiveMinutes = toCount(item?.archiveMinutes);

        data.push({
            id,
            guildId,
            channelId: trimTo(item?.channelId, 32),
            messageId: trimTo(item?.messageId, 32),
            mode: trimTo(item?.mode, 40),
            platform: trimTo(item?.platform, 40),
            vc: trimTo(item?.vc, 100),
            message: trimTo(item?.message, RECRUIT_MESSAGE_MAX),
            authorId: trimTo(item?.authorId, 32),
            authorName: trimTo(item?.authorName, 100),
            authorIcon: trimTo(item?.authorIcon, 500),
            startedAt,
            lastActivityAt,
            // 書き込みの数は、参加人数そのものではない（目安）
            messageCount: toCount(item?.messageCount),
            archiveMinutes,
            // ここで流れる時刻を決めておく。ページはこれと今を比べるだけ
            deadlineAt: deadlineOf({ lastActivityAt, startedAt, archiveMinutes }),
            syncedAt,
        });
    }

    return { data };
};

/**
 * いま立っている募集の一覧。新しい順に出す。
 *
 * Discord から流れる時刻を過ぎたもの（猶予を過ぎたもの）は出さない。bot が止まっても、
 * 終わった募集がいつまでも出たままにならない。
 */
export const handleRecruitList = async (env) => {
    const now = Date.now();
    const graceIso = new Date(now - RECRUIT_GRACE_MINUTES * 60 * 1000).toISOString();

    const [list, hidden, state] = await Promise.all([
        env.DB.prepare(RECRUIT_LIST_SQL).bind(graceIso, RECRUIT_MAX).all(),
        env.DB.prepare(RECRUIT_HIDDEN_SQL).bind(graceIso).first(),
        env.DB.prepare(`SELECT value FROM sync_state WHERE key = 'recruitments_synced_at'`).first(),
    ]);

    return htmlResponse(
        renderRecruitList({
            recruits: (list.results ?? []).map(toRecruit),
            syncedAt: state?.value ?? "",
            hiddenCount: hidden?.hidden ?? 0,
            now,
        }),
    );
};

/** DB の 1 行を、ページを組み立てるのに使う形にする */
const toRecruit = (row) => ({
    id: row.id,
    guildId: row.guild_id ?? "",
    mode: row.mode ?? "",
    platform: row.platform ?? "",
    vc: row.vc ?? "",
    message: row.message ?? "",
    authorName: row.author_name ?? "",
    authorIcon: row.author_icon ?? "",
    startedAt: row.started_at ?? "",
    lastActivityAt: row.last_activity_at ?? "",
    messageCount: row.message_count ?? 0,
    deadlineAt: row.deadline_at ?? "",
});
