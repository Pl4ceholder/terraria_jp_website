// ==========================================================================
// index.js — Cloudflare Workers の入口
//
// 役割は 2 つだけ。
//   1. 手書きのページ（public/ の中身）…… これは Cloudflare が直接返す
//   2. それ以外の動くページと API …… ここで組み立てて返す
//
// 動くページ・API は次のとおり。
//   GET  /columns /columns.html コラムの一覧（公開されたものだけ）
//   GET  /columns/<slug>.html   コラムの記事
//   GET  /img/<id>              記事の画像（D1 から返す）
//   POST /api/preview           書いた文章の下見（Markdown → HTML）
//   POST /api/columns           コラムの投稿（承認待ちで保存）
//   POST /api/images            画像のアップロード
//   POST /api/admin/...         運営の操作（承認・削除）
//   GET  /recruit /recruit.html マルチ募集の一覧（Discord の写し）
//   POST /api/internal/recruitments  Discord の bot から募集の一覧を受け取る
//   GET  /api/events            これからのイベント（お知らせページが取りに来る）
//   POST /api/internal/events   Discord の bot からイベントを受け取る
//
// 投稿は誰でもできる。公開は運営が承認したものだけ。
// 置き場所はすべて無料枠の範囲（Workers と D1）で使う。上限を超えたときは
// 「エラーになる」だけで、料金は発生しない。詳しくは README.md を参照。
// ==========================================================================

import { EVENT_LIST_SQL } from "./events.js";
import {
    deadlineOf,
    RECRUIT_HIDDEN_SQL,
    RECRUIT_LIST_SQL,
    RECRUIT_GRACE_MINUTES,
} from "./recruitments.js";
import { renderMarkdown, buildExcerpt } from "./markdown.js";
import { renderArticle, renderList, renderNotFound } from "./html.js";
import { renderRecruitList } from "./recruit.js";

/** 入力できる長さの上限 */
const LIMITS = {
    title: 120,
    body: 100_000,
    author: 40,
    tags: 100,
    slugHint: 40,
    preview: 100_000,
};

/** 同じ人が 1 時間に投稿できる回数（いたずら対策） */
const POSTS_PER_HOUR = 5;

/** 画像の条件（D1 の 1 行は 2MB まで。余裕をみて 1MB にする） */
const IMAGE_MAX_BYTES = 1 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** 画像をためておける合計。D1 無料枠（データベース 1 つ 500MB）に近づく前に断る */
const IMAGE_TOTAL_MAX_BYTES = 400 * 1024 * 1024;

/** 同じ人から 1 時間に上がる画像の数（置き場所を荒らされないため） */
const IMAGES_PER_HOUR = 20;

/** 運営のログイン（合言葉）の決まりごと */
const ADMIN_COOKIE = "admin_session";
const SESSION_HOURS = 12;
const LOGIN_FAILURES = 5;
const LOGIN_WINDOW_MINUTES = 10;

/** Discord の bot から募集を受け取るときの決まりごと */
const SYNC_SECRET_HEADER = "x-sync-secret";
const RECRUIT_SYNC_MAX_BYTES = 256 * 1024;
const RECRUIT_MAX = 100;
const RECRUIT_TEXT_MAX = 300;
const RECRUIT_MESSAGE_MAX = 1000;

/** Discord の bot からイベントを受け取るときの決まりごと */
const EVENT_SYNC_MAX_BYTES = 128 * 1024;
const EVENT_MAX = 100;
const EVENT_NAME_MAX = 200;
const EVENT_LOCATION_MAX = 200;
const EVENT_URL_MAX = 500;
const EVENT_DESCRIPTION_MAX = 2000;
/** 終わりが無いイベントを出しておく猶予（これより前に始まったものは出さない） */
const EVENT_GRACE_HOURS = 12;

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = decodeURIComponent(url.pathname);

        try {
            if (path === "/api/preview") return await handlePreview(request);
            if (path === "/api/columns") return await handlePost(request, env);
            if (path === "/api/images") return await handleUpload(request, env);
            if (path.startsWith("/img/")) return await handleImage(path.slice(5), env);

            if (path === "/api/admin/session") return await handleAdminSession(request, env);
            if (path === "/api/admin/columns") return await handleAdminList(request, env);

            const adminColumn = path.match(/^\/api\/admin\/columns\/([A-Za-z0-9-]+)$/);
            if (adminColumn) return await handleAdminAction(request, env, adminColumn[1]);

            // Discord の bot から届く（サーバーどうしなので、Origin ではなく合言葉で確かめる）
            if (path === "/api/internal/recruitments") {
                return await handleRecruitSync(request, env);
            }

            if (path === "/api/internal/events") {
                return await handleEventSync(request, env);
            }

            // お知らせページが取りに来る
            if (path === "/api/events") {
                return await handleEventList(env);
            }

            if (path === "/columns" || path === "/columns.html" || path === "/columns/") {
                return await handleColumnList(env);
            }

            const article = path.match(/^\/columns\/([^/]+)\.html$/);
            if (article) return await handleColumnArticle(env, article[1]);

            if (path === "/recruit" || path === "/recruit.html" || path === "/recruit/") {
                return await handleRecruitList(env);
            }
        } catch (error) {
            console.error("処理に失敗しました", path, error);
            return jsonResponse({ ok: false, message: "サーバー側で問題が起きました。" }, 500);
        }

        return new Response(renderNotFound(), {
            status: 404,
            headers: { "content-type": "text/html; charset=utf-8" },
        });
    },
};

// コラムの表示 --------------------------------------------------------------

/** 一覧。公開されたものだけを、新しい順に出す */
const handleColumnList = async (env) => {
    const { results } = await env.DB.prepare(
        `SELECT slug, title, body_md, author, tags, published_at, created_at
           FROM columns
          WHERE status = 'published'
          ORDER BY COALESCE(published_at, created_at) DESC, title ASC`,
    ).all();

    return htmlResponse(renderList((results ?? []).map(toColumn)));
};

/** 記事 1 件。公開されていないものは、あったこと自体を出さない */
const handleColumnArticle = async (env, slug) => {
    const row = await env.DB.prepare(
        `SELECT slug, title, body_md, body_html, author, tags, published_at, created_at
           FROM columns
          WHERE slug = ?1 AND status = 'published'`,
    )
        .bind(slug)
        .first();

    if (!row) {
        return new Response(renderNotFound(), {
            status: 404,
            headers: { "content-type": "text/html; charset=utf-8" },
        });
    }

    return htmlResponse(renderArticle(toColumn(row)));
};

/** DB の 1 行を、ページを組み立てるのに使う形にする */
const toColumn = (row) => ({
    slug: row.slug,
    title: row.title,
    body: row.body_md ?? "",
    html: row.body_html ?? "",
    author: row.author ?? "",
    tags: (row.tags ?? "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    // 公開した日を記事の日付にする。公開前は投稿した日。
    date: String(row.published_at || row.created_at || "").slice(0, 10),
});

// 投稿 ----------------------------------------------------------------------

/** 書いた文章の下見。保存はしない */
const handlePreview = async (request) => {
    if (request.method !== "POST") return methodNotAllowed("POST");

    const payload = await readJson(request, LIMITS.preview * 2);
    if (payload.error) return payload.error;

    const body = String(payload.data?.body ?? "");
    if (body.length > LIMITS.preview) {
        return jsonResponse({ ok: false, message: "本文が長すぎます。" }, 413);
    }

    return jsonResponse({ ok: true, html: renderMarkdown(body) });
};

/** コラムの投稿。承認待ちとして保存する */
const handlePost = async (request, env) => {
    if (request.method !== "POST") return methodNotAllowed("POST");

    const payload = await readJson(request, LIMITS.body * 2);
    if (payload.error) return payload.error;

    const input = payload.data ?? {};

    // いたずら避けのわな。画面には出さない欄なので、埋まっていたら機械による投稿。
    if (String(input.website ?? "").trim() !== "") {
        return jsonResponse({ ok: false, message: "投稿を受け付けられませんでした。" }, 400);
    }

    const title = String(input.title ?? "").trim();
    const body = String(input.body ?? "").trim();
    const author = String(input.author ?? "").trim();
    const tags = String(input.tags ?? "").trim();
    const slugHint = String(input.slug ?? "").trim();

    const problem = validatePost({ title, body, author, tags, slugHint });
    if (problem) return jsonResponse({ ok: false, message: problem }, 400);

    const ipHash = await hashIp(request, env);
    const recent = await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM columns WHERE ip_hash = ?1 AND created_at > ?2`,
    )
        .bind(ipHash, new Date(Date.now() - 60 * 60 * 1000).toISOString())
        .first();

    if ((recent?.count ?? 0) >= POSTS_PER_HOUR) {
        return jsonResponse(
            {
                ok: false,
                message: `投稿が続いています。少し時間をおいてから、もう一度お試しください。`,
            },
            429,
        );
    }

    const now = new Date().toISOString();
    const html = renderMarkdown(body);
    const tagList = splitTags(tags);

    // slug は URL になる。重なったら作り直す。
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const slug = buildSlug(slugHint || title);

        try {
            await env.DB.prepare(
                `INSERT INTO columns
                     (id, slug, title, body_md, body_html, author, tags, status, created_at, published_at, ip_hash)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8, NULL, ?9)`,
            )
                .bind(
                    crypto.randomUUID(),
                    slug,
                    title,
                    body,
                    html,
                    author,
                    tagList.join(","),
                    now,
                    ipHash,
                )
                .run();

            return jsonResponse({ ok: true, slug });
        } catch (error) {
            // UNIQUE 制約（slug の重なり）だけは作り直せば直る
            if (!String(error?.message ?? "").includes("UNIQUE")) throw error;
        }
    }

    return jsonResponse(
        {
            ok: false,
            message: "URL の名前を決められませんでした。少し変えて、もう一度お試しください。",
        },
        409,
    );
};

/** 投稿の中身を確かめる。問題があればメッセージを返す */
const validatePost = ({ title, body, author, tags, slugHint }) => {
    if (!title) return "タイトルを入力してください。";
    if (title.length > LIMITS.title) return `タイトルは ${LIMITS.title} 文字までにしてください。`;
    if (!body) return "本文を入力してください。";
    if (body.length > LIMITS.body) return "本文が長すぎます。";
    if (author.length > LIMITS.author)
        return `書いた人は ${LIMITS.author} 文字までにしてください。`;
    if (tags.length > LIMITS.tags) return `タグは ${LIMITS.tags} 文字までにしてください。`;
    if (slugHint && !/^[a-zA-Z0-9-]+$/.test(slugHint)) {
        return "URL の名前は、半角英数字とハイフンだけで入力してください。";
    }
    return "";
};

/** 「a, b、c」のような入力を配列にする */
const splitTags = (tags) =>
    String(tags)
        .split(/[,、]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 10);

/** タイトルや指定から URL の名前を作る。日本語だけのときは column にする */
const buildSlug = (source) => {
    const base = String(source)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, LIMITS.slugHint);

    // 日本語だけのタイトルだと 1 文字しか残らないことがある。短いときは column にする。
    const name = base.length >= 3 ? base : "column";

    return `${name}-${crypto.randomUUID().replace(/-/g, "").slice(0, 6)}`;
};

// 画像 ----------------------------------------------------------------------

/** 画像を受け取って D1 に入れる */
const handleUpload = async (request, env) => {
    if (request.method !== "POST") return methodNotAllowed("POST");

    const form = await request.formData().catch(() => null);

    if (!form) {
        return jsonResponse({ ok: false, message: "画像を受け取れませんでした。" }, 400);
    }

    const file = form.get("image");

    if (!file || typeof file === "string") {
        return jsonResponse({ ok: false, message: "画像が選ばれていません。" }, 400);
    }

    if (!IMAGE_TYPES.has(file.type)) {
        return jsonResponse(
            { ok: false, message: "PNG / JPEG / GIF / WebP の画像を選んでください。" },
            415,
        );
    }

    if (file.size > IMAGE_MAX_BYTES) {
        return jsonResponse({ ok: false, message: "画像は 1MB までです。" }, 413);
    }

    const ipHash = await hashIp(request, env);
    const recent = await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM uploads WHERE ip_hash = ?1 AND created_at > ?2`,
    )
        .bind(ipHash, new Date(Date.now() - 60 * 60 * 1000).toISOString())
        .first();

    if ((recent?.count ?? 0) >= IMAGES_PER_HOUR) {
        return jsonResponse(
            {
                ok: false,
                message:
                    "画像のアップロードが続いています。少し時間をおいてから、もう一度お試しください。",
            },
            429,
        );
    }

    const now = new Date().toISOString();
    const stored = await env.DB.prepare(
        `SELECT COALESCE(SUM(size), 0) AS total FROM images`,
    ).first();

    if ((stored?.total ?? 0) + file.size > IMAGE_TOTAL_MAX_BYTES) {
        return jsonResponse(
            {
                ok: false,
                message: "画像を置ける場所がいっぱいです。お手数ですが、運営にご連絡ください。",
            },
            507,
        );
    }

    const id = crypto.randomUUID().replace(/-/g, "");

    // 画像と、数えた記録を入れる。ついでに 1 日より古い記録は片付ける。
    await env.DB.batch([
        env.DB.prepare(`DELETE FROM uploads WHERE created_at < ?1`).bind(
            new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        ),
        env.DB.prepare(`INSERT INTO uploads (id, ip_hash, created_at) VALUES (?1, ?2, ?3)`).bind(
            crypto.randomUUID(),
            ipHash,
            now,
        ),
        env.DB.prepare(
            `INSERT INTO images (id, content_type, size, data, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`,
        ).bind(id, file.type, file.size, await file.arrayBuffer(), now),
    ]);

    return jsonResponse({ ok: true, url: `/img/${id}` });
};

/** D1 は BLOB を数値の配列で返す。ArrayBuffer で来ても扱えるようにしておく */
const toBytes = (data) =>
    data instanceof ArrayBuffer ? new Uint8Array(data) : Uint8Array.from(data);

/** 記事で使う画像を D1 から返す */
const handleImage = async (id, env) => {
    const row = await env.DB.prepare(`SELECT content_type, data FROM images WHERE id = ?1`)
        .bind(id)
        .first();

    if (!row) {
        return new Response("Not found", { status: 404 });
    }

    return new Response(toBytes(row.data), {
        headers: {
            "content-type": row.content_type,
            "cache-control": "public, max-age=31536000, immutable",
        },
    });
};

// マルチ募集（Discord の写し） -----------------------------------------------

/**
 * Discord の bot から、いま立っている募集の一覧を受け取る。
 *
 * 募集の持ち主は Discord 側なので、届いた内容で丸ごと入れ替える。
 * 何度届いても同じ結果になり、途中で切れても中途半端な一覧は残らない。
 */
const handleRecruitSync = async (request, env) => {
    if (request.method !== "POST") return methodNotAllowed("POST");

    // 合言葉と同じ考え方。設定していなければ、誰も書き込めない。
    if (!env.SYNC_SECRET) {
        return jsonResponse({ ok: false, message: "同期の設定がされていません。" }, 503);
    }

    if (!isSame(request.headers.get(SYNC_SECRET_HEADER) ?? "", env.SYNC_SECRET)) {
        return jsonResponse({ ok: false, message: "受け付けられませんでした。" }, 401);
    }

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
                      connection, message, author_id, author_name, author_icon, started_at,
                      last_activity_at, message_count, archive_minutes, deadline_at, synced_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                         ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)`,
            ).bind(
                row.id,
                row.guildId,
                row.channelId,
                row.messageId,
                row.mode,
                row.platform,
                row.vc,
                row.connection,
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
            connection: trimTo(item?.connection, RECRUIT_TEXT_MAX),
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
const handleRecruitList = async (env) => {
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
    connection: row.connection ?? "",
    message: row.message ?? "",
    authorName: row.author_name ?? "",
    authorIcon: row.author_icon ?? "",
    startedAt: row.started_at ?? "",
    lastActivityAt: row.last_activity_at ?? "",
    messageCount: row.message_count ?? 0,
    deadlineAt: row.deadline_at ?? "",
});

/** 送られてきた値を、長さを切った文字列にする */
const trimTo = (value, max) =>
    String(value ?? "")
        .trim()
        .slice(0, max);

/** 日時を ISO の形にする。読めないときは、代わりの時刻にする */
const toIso = (value, fallback) => {
    const time = Date.parse(String(value ?? ""));

    return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
};

// Discord のイベント ---------------------------------------------------------

/**
 * Discord の bot から、これからのイベントを受け取る。
 *
 * 募集と同じ考え方。届いた内容で丸ごと入れ替えるので、何度届いても同じ結果になる。
 * 内容（名前・説明・場所・時刻）が変わったときも、次の入れ替えで新しい内容になる。
 * 終わったイベントは Discord が返さなくなるので、次の入れ替えで自然に消える。
 */
const handleEventSync = async (request, env) => {
    if (request.method !== "POST") return methodNotAllowed("POST");

    if (!env.SYNC_SECRET) {
        return jsonResponse({ ok: false, message: "同期の設定がされていません。" }, 503);
    }

    if (!isSame(request.headers.get(SYNC_SECRET_HEADER) ?? "", env.SYNC_SECRET)) {
        return jsonResponse({ ok: false, message: "受け付けられませんでした。" }, 401);
    }

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
const handleEventList = async (env) => {
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

/** 人数のような数を、安全な整数にする */
const toCount = (value) => {
    const count = Number(value);

    return Number.isInteger(count) && count > 0 ? count : 0;
};

// 運営（承認） ---------------------------------------------------------------

/**
 * 合言葉での出入り。
 *   GET    … いま入っているかどうか
 *   POST   … 合言葉を確かめて、通ったらクッキーを渡す
 *   DELETE … 出る
 */
const handleAdminSession = async (request, env) => {
    if (request.method === "GET") {
        return jsonResponse({ ok: await isAdmin(request, env) });
    }

    if (request.method === "DELETE") {
        if (!isSameOrigin(request)) return forbidden();

        return jsonResponse({ ok: true }, 200, {
            "set-cookie": `${ADMIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
        });
    }

    if (request.method !== "POST") return methodNotAllowed("GET, POST, DELETE");
    if (!isSameOrigin(request)) return forbidden();

    // 合言葉が設定されていなければ誰も入れない。
    // 設定し忘れたまま、誰でも入れる状態になるのを防ぐ。
    if (!env.ADMIN_PASSWORD) {
        return jsonResponse({ ok: false, message: "合言葉が設定されていません。" }, 503);
    }

    const payload = await readJson(request, 4096);
    if (payload.error) return payload.error;

    const ipHash = await hashIp(request, env);
    if (await isLoginBlocked(env, ipHash)) {
        return jsonResponse(
            {
                ok: false,
                message: "間違いが続いています。しばらく待ってから、もう一度お試しください。",
            },
            429,
        );
    }

    const password = String(payload.data?.password ?? "");
    if (!isSame(password, env.ADMIN_PASSWORD)) {
        await recordLoginFailure(env, ipHash);
        return jsonResponse({ ok: false, message: "合言葉が違います。" }, 401);
    }

    // 本番（https）のときだけ Secure を付ける。
    // 付けっぱなしにすると、ローカル（http）でクッキーが保存されず確認できなくなる。
    const secure = new URL(request.url).protocol === "https:";

    return jsonResponse({ ok: true }, 200, {
        "set-cookie": buildSessionCookie(await issueSession(env), secure),
    });
};

/** 承認待ち・公開中・見送りを、状態ごとに出す */
const handleAdminList = async (request, env) => {
    if (!(await isAdmin(request, env))) return unauthorized();

    const asked = new URL(request.url).searchParams.get("status") ?? "";
    const status = ["pending", "published", "rejected"].includes(asked) ? asked : "pending";

    const { results } = await env.DB.prepare(
        `SELECT id, slug, title, body_html, author, tags, status, created_at, published_at
           FROM columns
          WHERE status = ?1
          ORDER BY created_at DESC
          LIMIT 50`,
    )
        .bind(status)
        .all();

    const { results: counts } = await env.DB.prepare(
        `SELECT status, COUNT(*) AS count FROM columns GROUP BY status`,
    ).all();

    return jsonResponse({
        ok: true,
        status,
        counts: sumByStatus(counts),
        columns: (results ?? []).map(toAdminColumn),
    });
};

/** 公開する・見送る・承認待ちに戻す・削除する */
const handleAdminAction = async (request, env, id) => {
    if (request.method !== "POST") return methodNotAllowed("POST");
    if (!isSameOrigin(request)) return forbidden();
    if (!(await isAdmin(request, env))) return unauthorized();

    const payload = await readJson(request, 4096);
    if (payload.error) return payload.error;

    const action = String(payload.data?.action ?? "");

    if (action === "delete") {
        await env.DB.prepare(`DELETE FROM columns WHERE id = ?1`).bind(id).run();
        return jsonResponse({ ok: true });
    }

    const status = { publish: "published", reject: "rejected", pending: "pending" }[action];
    if (!status) {
        return jsonResponse({ ok: false, message: "知らない操作です。" }, 400);
    }

    // 公開したときだけ日付を入れる。すでに入っていれば残す（公開し直しても日付が変わらない）。
    // 承認待ちに戻したら日付は消す。
    await env.DB.prepare(
        `UPDATE columns
            SET status = ?1,
                published_at = CASE WHEN ?1 = 'published' THEN COALESCE(published_at, ?2) ELSE NULL END
          WHERE id = ?3`,
    )
        .bind(status, new Date().toISOString(), id)
        .run();

    return jsonResponse({ ok: true });
};

/** DB の 1 行を、承認画面で使う形にする */
const toAdminColumn = (row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    html: row.body_html ?? "",
    author: row.author ?? "",
    tags: (row.tags ?? "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    status: row.status,
    createdAt: row.created_at ?? "",
    publishedAt: row.published_at ?? "",
});

/** 状態ごとの件数を、必ず 3 つそろえて返す */
const sumByStatus = (rows) => {
    const counts = { pending: 0, published: 0, rejected: 0 };

    for (const row of rows ?? []) {
        if (row.status in counts) counts[row.status] = row.count;
    }

    return counts;
};

// 共通の道具 ----------------------------------------------------------------

/** いたずら対策。IP そのものは残さず、毎回同じ値になる形にして保存する */
const hashIp = async (request, env) => {
    const ip = request.headers.get("cf-connecting-ip") ?? "";
    const salt = env.IP_SALT ?? "terraria-jp";
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip}`));

    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

/** 合言葉を確かめて、通った人に渡す「入っている証」 */
const issueSession = async (env) => {
    const expires = Date.now() + SESSION_HOURS * 60 * 60 * 1000;

    return `${expires}.${await sign(env, String(expires))}`;
};

/** 渡された証が本物で、まだ期限が切れていないか */
const verifySession = async (request, env) => {
    const [expires, signature] = readCookie(request, ADMIN_COOKIE).split(".");
    if (!expires || !signature) return false;
    if (Number(expires) < Date.now()) return false;

    return isSame(signature, await sign(env, expires));
};

const isAdmin = async (request, env) => {
    if (!env.ADMIN_PASSWORD) return false;

    return verifySession(request, env);
};

/** 証が本物かを見分けるための印。合言葉を鍵にして作る */
const sign = async (env, message) => {
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(env.ADMIN_PASSWORD ?? ""),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));

    return [...new Uint8Array(signature)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
};

/** 文字列が同じかどうか。全部を見比べて、時間で中身を推測されないようにする */
const isSame = (a, b) => {
    if (a.length !== b.length) return false;

    let difference = 0;
    for (let index = 0; index < a.length; index += 1) {
        difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
    }

    return difference === 0;
};

const readCookie = (request, name) => {
    for (const part of (request.headers.get("cookie") ?? "").split(";")) {
        const separator = part.indexOf("=");
        if (separator !== -1 && part.slice(0, separator).trim() === name) {
            return part.slice(separator + 1).trim();
        }
    }

    return "";
};

const buildSessionCookie = (value, secure) =>
    `${ADMIN_COOKIE}=${value}; Path=/; Max-Age=${SESSION_HOURS * 60 * 60}; HttpOnly; SameSite=Lax${
        secure ? "; Secure" : ""
    }`;

/** 別のサイトから勝手に送られたものではないか（クッキーを使う操作の護り） */
const isSameOrigin = (request) => {
    const origin = request.headers.get("origin");

    return origin === null || origin === new URL(request.url).origin;
};

const isLoginBlocked = async (env, ipHash) => {
    const row = await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM logins WHERE ip_hash = ?1 AND created_at > ?2`,
    )
        .bind(ipHash, new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60 * 1000).toISOString())
        .first();

    return (row?.count ?? 0) >= LOGIN_FAILURES;
};

const recordLoginFailure = async (env, ipHash) => {
    await env.DB.batch([
        env.DB.prepare(`DELETE FROM logins WHERE created_at < ?1`).bind(
            new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        ),
        env.DB.prepare(`INSERT INTO logins (id, ip_hash, created_at) VALUES (?1, ?2, ?3)`).bind(
            crypto.randomUUID(),
            ipHash,
            new Date().toISOString(),
        ),
    ]);
};

const unauthorized = () => jsonResponse({ ok: false, message: "合言葉を入れてください。" }, 401);

const forbidden = () => jsonResponse({ ok: false, message: "受け付けられませんでした。" }, 403);

/** JSON を読む。大きすぎるものは読み込まずに断る */
const readJson = async (request, maxBytes) => {
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > maxBytes) {
        return {
            error: jsonResponse({ ok: false, message: "送信された内容が大きすぎます。" }, 413),
        };
    }

    try {
        return { data: await request.json() };
    } catch {
        return {
            error: jsonResponse({ ok: false, message: "送信された内容を読めませんでした。" }, 400),
        };
    }
};

const jsonResponse = (data, status = 200, headers = {}) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { "content-type": "application/json; charset=utf-8", ...headers },
    });

const htmlResponse = (html) =>
    new Response(html, {
        headers: {
            "content-type": "text/html; charset=utf-8",
            // 投稿の承認・取り消しがすぐ見えるように、長く持たせない
            "cache-control": "no-cache",
        },
    });

const methodNotAllowed = (allow) =>
    new Response(JSON.stringify({ ok: false, message: `${allow} で送ってください。` }), {
        status: 405,
        headers: { "content-type": "application/json; charset=utf-8", allow },
    });
