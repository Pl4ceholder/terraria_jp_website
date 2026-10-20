// ==========================================================================
// events-api.js — Discord のイベントの受け取りと、お知らせページ向けの API
//
// 募集と同じ考え方。届いた内容で丸ごと入れ替えるので、何度届いても同じ結果に
// なる。終わったイベントは Discord が返さなくなるので、次の入れ替えで消える。
//
// どれを出すか（終わったもの・これからのもの）の決め方は events.js に 1 つだけ。
// ==========================================================================

import { EVENT_LIST_SQL } from "./events.js";
import { jsonResponse, methodNotAllowed, readJson } from "./http.js";
import { checkSyncSecret } from "./sync.js";
import { toCount, toIso, trimTo } from "./values.js";

const EVENT_SYNC_MAX_BYTES = 128 * 1024;
const EVENT_MAX = 100;
const EVENT_NAME_MAX = 200;
const EVENT_LOCATION_MAX = 200;
const EVENT_URL_MAX = 500;
const EVENT_DESCRIPTION_MAX = 2000;
/** 終わりが無いイベントを出しておく猶予（これより前に始まったものは出さない） */
const EVENT_GRACE_HOURS = 12;

/**
 * Discord の bot から、これからのイベントを受け取る。
 *
 * 募集と同じ考え方。届いた内容で丸ごと入れ替えるので、何度届いても同じ結果になる。
 * 内容（名前・説明・場所・時刻）が変わったときも、次の入れ替えで新しい内容になる。
 * 終わったイベントは Discord が返さなくなるので、次の入れ替えで自然に消える。
 */
export const handleEventSync = async (request, env) => {
    if (request.method !== "POST") return methodNotAllowed("POST");

    const denied = checkSyncSecret(request, env);
    if (denied) return denied;

    const payload = await readJson(request, EVENT_SYNC_MAX_BYTES);
    if (payload.error) return payload.error;

    const now = new Date().toISOString();
    const rows = toEventRows(payload.data, now);
    if (rows.error) return jsonResponse({ ok: false, message: rows.error }, 400);

    await env.DB.batch([
        env.DB.prepare(`DELETE FROM events`),
        ...rows.data.map((row) =>
            env.DB.prepare(
                `INSERT INTO events
                     (id, guild_id, name, description, location, cover_url, url,
                      user_count, start_at, end_at, synced_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
            ).bind(
                row.id,
                row.guildId,
                row.name,
                row.description,
                row.location,
                row.coverUrl,
                row.url,
                row.userCount,
                row.startAt,
                row.endAt,
                row.syncedAt,
            ),
        ),
        env.DB.prepare(
            `INSERT INTO sync_state (key, value) VALUES ('events_synced_at', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        ).bind(now),
    ]);

    return jsonResponse({ ok: true, count: rows.data.length });
};

/** Discord から届いた内容を、保存できる形に整える。おかしければメッセージを返す */
const toEventRows = (payload, syncedAt) => {
    const list = Array.isArray(payload?.events) ? payload.events : null;
    if (!list) return { error: "イベントの一覧が入っていません。" };

    const guildId = trimTo(payload?.guildId, 32);
    if (!guildId) return { error: "Discord のサーバー ID が入っていません。" };
    if (list.length > EVENT_MAX) return { error: `イベントは一度に ${EVENT_MAX} 件までです。` };

    const data = [];
    const seen = new Set();

    for (const item of list) {
        const id = trimTo(item?.id, 32);
        if (!id || seen.has(id)) continue;
        seen.add(id);

        // 始まる時刻が分からないものは、いつ出すのか決められないので入れない
        const startAt = toIso(item?.startAt, "");
        if (!startAt) continue;

        data.push({
            id,
            guildId,
            name: trimTo(item?.name, EVENT_NAME_MAX),
            description: trimTo(item?.description, EVENT_DESCRIPTION_MAX),
            location: trimTo(item?.location, EVENT_LOCATION_MAX),
            coverUrl: trimTo(item?.coverUrl, EVENT_URL_MAX),
            url: trimTo(item?.url, EVENT_URL_MAX),
            userCount: toCount(item?.userCount),
            startAt,
            endAt: toIso(item?.endAt, null),
            syncedAt,
        });
    }

    return { data };
};

/** これからのイベント。お知らせページが取りに来る（選び方は events.js に 1 つだけ） */
export const handleEventList = async (env) => {
    const now = Date.now();
    const graceIso = new Date(now - EVENT_GRACE_HOURS * 60 * 60 * 1000).toISOString();

    const [list, state] = await Promise.all([
        env.DB.prepare(EVENT_LIST_SQL).bind(new Date(now).toISOString(), graceIso, EVENT_MAX).all(),
        env.DB.prepare(`SELECT value FROM sync_state WHERE key = 'events_synced_at'`).first(),
    ]);

    return jsonResponse(
        {
            ok: true,
            syncedAt: state?.value ?? "",
            events: (list.results ?? []).map(toEvent),
        },
        200,
        // イベントが増えたときに 1 分以内で見えるようにする
        { "cache-control": "public, max-age=60" },
    );
};

/** DB の 1 行を、お知らせページに渡す形にする */
const toEvent = (row) => ({
    id: row.id,
    name: row.name ?? "",
    description: row.description ?? "",
    location: row.location ?? "",
    coverUrl: row.cover_url ?? "",
    url: row.url ?? "",
    userCount: row.user_count ?? 0,
    startAt: row.start_at ?? "",
    endAt: row.end_at ?? "",
});
