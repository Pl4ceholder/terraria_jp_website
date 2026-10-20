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
//   POST /api/internal/achievements  Discord の bot から実績を受け取る（マイページ用）
//   GET  /api/internal/requests  Discord の bot が、Web からの依頼（実績・称号）を拾う
//   POST /api/internal/requests/<id>  Discord の bot が、依頼の結果を書き戻す
//   GET  /mypage /mypage.html   マイページ（Discord でログインした人だけ）
//   POST /mypage/title          称号の着脱の依頼を置く（反映するのは bot）
//   GET  /activities            活動の一覧（Discord のチャンネル風）
//   POST /activities            活動を立てる（Discord でログインした人だけ・承認待ち）
//   GET  /activities/<id>       活動 1 本（Discord のスレッド風）
//   POST /activities/<id>/posts 活動に書き足す（立てた本人だけ・承認待ち）
//   GET  /activities/new        活動を書くページ
//   GET  /admin/activities      活動の承認（合言葉で入った人だけ）
//   POST /admin/activities      公開・見送り・取り下げ
//   GET  /admin/achievements    実績の付与・剥奪（合言葉で入った人だけ）
//   POST /admin/achievements    付与・剥奪の依頼を置く（反映するのは bot）
//   GET  /auth/discord          Discord の認証画面へ送る
//   GET  /auth/discord/callback 認証から戻ってきた人に、入っている証を渡す
//   POST /auth/logout           出る
//
// 投稿は誰でもできる。公開は運営が承認したものだけ。
// 置き場所はすべて無料枠の範囲（Workers と D1）で使う。上限を超えたときは
// 「エラーになる」だけで、料金は発生しない。詳しくは README.md を参照。
// ==========================================================================

import { EVENT_LIST_SQL } from "./events.js";
import {
    ACHIEVEMENT_LIST_SQL,
    MEMBER_LIST_SQL,
    MEMBER_ONE_SQL,
    MEMBER_SEARCH_SQL,
    toAchievementRows,
} from "./achievements.js";
import {
    parseUserId,
    REQUEST_CLEANUP_SQL,
    REQUEST_FINISH_SQL,
    REQUEST_INSERT_SQL,
    REQUEST_LAST_FOR_USER_SQL,
    REQUEST_LIST_MAX,
    REQUEST_PENDING_FOR_USER_SQL,
    REQUEST_PENDING_SQL,
    REQUEST_DUPLICATE_SQL,
    REQUEST_PENDING_ANY_SQL,
    toRequest,
    toRequestList,
    toRequestView,
    toResult,
} from "./requests.js";
import { renderAdminAchievements } from "./admin-achievements.js";
import { renderAdminActivities } from "./admin-activities.js";
import {
    ACTIVITY_INSERT_SQL,
    ACTIVITY_LIST_MAX,
    ACTIVITY_LIST_SQL,
    ACTIVITY_ONE_SQL,
    ACTIVITY_PENDING_POSTS_SQL,
    ACTIVITY_POSTS_MAX,
    ACTIVITY_POSTS_PER_HOUR,
    ACTIVITY_POSTS_SQL,
    ACTIVITY_POST_COUNT_SQL,
    ACTIVITY_POST_INSERT_SQL,
    ACTIVITY_POST_ONE_SQL,
    ACTIVITY_POST_PUBLISH_SQL,
    ACTIVITY_POST_REJECT_SQL,
    ACTIVITY_PUBLISH_SQL,
    ACTIVITY_RECENT_POSTS_SQL,
    ACTIVITY_RECENT_THREADS_SQL,
    ACTIVITY_REFRESH_SQL,
    ACTIVITY_REJECT_SQL,
    ACTIVITY_THREADS_PER_HOUR,
    ADMIN_ACTIVITY_LIST_MAX,
    ADMIN_PENDING_POSTS_SQL,
    ADMIN_PENDING_THREADS_SQL,
    ADMIN_RECENT_THREADS_SQL,
    canSee,
    parsePost,
    parseThread,
    toPost,
    toThread,
    toThreadCard,
} from "./activities.js";
import {
    renderActivity,
    renderActivityForm,
    renderActivityList,
    renderActivityLogin,
    renderActivityMissing,
} from "./activity.js";
import {
    buildAuthorizeUrl,
    buildStateCookie,
    buildStateValue,
    buildUserCookie,
    clearStateCookie,
    clearUserCookie,
    exchangeCode,
    fetchUser,
    isConfigured,
    isSecure,
    isSameState,
    issueUserSession,
    makeState,
    nextAfterLogin,
    readUserSession,
    redirectUriOf,
} from "./auth.js";
import { isSame, readCookie, signWithKey } from "./signing.js";
import { renderAuthError, renderLogin, renderMypage, renderUnconfigured } from "./mypage.js";
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

/** Discord の bot から実績を受け取るときの決まりごと（数の上限は achievements.js にある） */
const ACHIEVEMENT_SYNC_MAX_BYTES = 128 * 1024;

/** Web からの依頼（実績の付与・称号の着脱）を、処理したあと残しておく日数 */
const REQUEST_KEEP_DAYS = 7;

/** bot が書き戻す結果の大きさ */
const REQUEST_RESULT_MAX_BYTES = 4096;

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

            // マイページ（Discord でログインした人だけ）
            if (path === "/mypage" || path === "/mypage.html" || path === "/mypage/") {
                return await handleMypage(request, env);
            }

            if (path === "/auth/discord") return await handleDiscordAuth(request, env);
            if (path === "/auth/discord/callback") return await handleDiscordCallback(request, env);
            if (path === "/auth/logout") return await handleDiscordLogout(request);

            // Discord の bot から届く（サーバーどうしなので、Origin ではなく合言葉で確かめる）
            if (path === "/api/internal/recruitments") {
                return await handleRecruitSync(request, env);
            }

            if (path === "/api/internal/events") {
                return await handleEventSync(request, env);
            }

            if (path === "/api/internal/achievements") {
                return await handleAchievementSync(request, env);
            }

            // Web からの依頼（実績の付与・称号の着脱）。bot が拾って Discord に反映する
            if (path === "/api/internal/requests") {
                return await handleRequestList(request, env);
            }

            const requestResult = path.match(/^\/api\/internal\/requests\/(\d+)$/);
            if (requestResult) {
                return await handleRequestResult(request, env, Number(requestResult[1]));
            }

            if (path === "/mypage/title") return await handleTitleRequest(request, env);

            if (path === "/admin/achievements") return await handleAdminAchievements(request, env);
            if (path === "/admin/activities") return await handleAdminActivities(request, env);

            // 活動（Discord のスレッド風）。書けるのは Discord でログインした人だけ
            if (path === "/activities" || path === "/activities.html" || path === "/activities/") {
                return request.method === "POST"
                    ? await handleActivityCreate(request, env)
                    : await handleActivityList(request, env);
            }

            if (path === "/activities/new" || path === "/activities/new/") {
                return await handleActivityNew(request, env);
            }

            const activityPost = path.match(/^\/activities\/([A-Za-z0-9-]{4,32})\/posts$/);
            if (activityPost) return await handleActivityPost(request, env, activityPost[1]);

            const activityPage = path.match(/^\/activities\/([A-Za-z0-9-]{4,32})$/);
            if (activityPage) return await handleActivityPage(request, env, activityPage[1]);

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

// Discord の実績（マイページ） -----------------------------------------------

/**
 * Discord の bot から、実績（誰が何を解放したか）を受け取る。
 *
 * 募集・イベントと同じで、届いた内容で丸ごと入れ替える。何度届いても同じ結果になる。
 * 実績の付与は Discord で手動で行うので、届くのは 30 分に 1 回ほど（cogs/sync.py）。
 * 書き込みを無駄に増やさないための間隔で、サイト側はこれを気にしない。
 */
const handleAchievementSync = async (request, env) => {
    if (request.method !== "POST") return methodNotAllowed("POST");

    if (!env.SYNC_SECRET) {
        return jsonResponse({ ok: false, message: "同期の設定がされていません。" }, 503);
    }

    if (!isSame(request.headers.get(SYNC_SECRET_HEADER) ?? "", env.SYNC_SECRET)) {
        return jsonResponse({ ok: false, message: "受け付けられませんでした。" }, 401);
    }

    const payload = await readJson(request, ACHIEVEMENT_SYNC_MAX_BYTES);
    if (payload.error) return payload.error;

    const now = new Date().toISOString();
    const rows = toAchievementRows(payload.data, now);
    if (rows.error) return jsonResponse({ ok: false, message: rows.error }, 400);

    await env.DB.batch([
        env.DB.prepare(`DELETE FROM achievements`),
        env.DB.prepare(`DELETE FROM member_achievements`),
        ...rows.data.master.map((row) =>
            env.DB.prepare(
                `INSERT INTO achievements (id, name, position, synced_at)
                 VALUES (?1, ?2, ?3, ?4)`,
            ).bind(row.id, row.name, row.position, row.syncedAt),
        ),
        ...rows.data.members.map((row) =>
            env.DB.prepare(
                `INSERT INTO member_achievements (user_id, unlocked, title, synced_at)
                 VALUES (?1, ?2, ?3, ?4)`,
            ).bind(row.userId, row.unlocked, row.title, row.syncedAt),
        ),
        env.DB.prepare(
            `INSERT INTO sync_state (key, value) VALUES ('achievements_synced_at', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        ).bind(now),
        // 片付ける依頼は、このついでに消す（残しておく理由が無いので）。
        // まだ処理していない依頼（pending）は消さない。
        env.DB.prepare(REQUEST_CLEANUP_SQL).bind(
            new Date(Date.now() - REQUEST_KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString(),
        ),
    ]);

    return jsonResponse({
        ok: true,
        achievements: rows.data.master.length,
        members: rows.data.members.length,
    });
};

// Web からの依頼（実績の付与・称号の着脱） -----------------------------------

/**
 * bot が、まだ処理していない依頼を拾いに来る。
 *
 * サイトは Discord を触らないので、Web の操作はここに依頼として溜まる。bot が 30 秒
 * ごとに取りに来て、Discord に反映し、結果を書き戻す（POST /api/internal/requests/<id>）。
 * bot が止まっている間も依頼は残るので、操作が消えることはない。
 */
const handleRequestList = async (request, env) => {
    if (request.method !== "GET") return methodNotAllowed("GET");
    if (!env.SYNC_SECRET) {
        return jsonResponse({ ok: false, message: "同期の設定がされていません。" }, 503);
    }
    if (!isSame(request.headers.get(SYNC_SECRET_HEADER) ?? "", env.SYNC_SECRET)) {
        return jsonResponse({ ok: false, message: "受け付けられませんでした。" }, 401);
    }

    const { results } = await env.DB.prepare(REQUEST_PENDING_SQL).bind(REQUEST_LIST_MAX).all();

    return jsonResponse({ ok: true, requests: toRequestList(results) });
};

/** bot が、依頼の結果を書き戻す。すでに処理済みのものは上書きしない */
const handleRequestResult = async (request, env, id) => {
    if (request.method !== "POST") return methodNotAllowed("POST");
    if (!env.SYNC_SECRET) {
        return jsonResponse({ ok: false, message: "同期の設定がされていません。" }, 503);
    }
    if (!isSame(request.headers.get(SYNC_SECRET_HEADER) ?? "", env.SYNC_SECRET)) {
        return jsonResponse({ ok: false, message: "受け付けられませんでした。" }, 401);
    }

    const payload = await readJson(request, REQUEST_RESULT_MAX_BYTES);
    if (payload.error) return payload.error;

    const parsed = toResult(payload.data);
    if (parsed.error) return jsonResponse({ ok: false, message: parsed.error }, 400);

    const result = await env.DB.prepare(REQUEST_FINISH_SQL)
        .bind(parsed.data.status, new Date().toISOString(), parsed.data.message, id)
        .run();

    return jsonResponse({ ok: true, changed: result.meta?.changes ?? 0 });
};

// マイページ（Discord でログインした人だけ） ---------------------------------

/**
 * マイページ。
 *
 * ログインの設定（DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET）が無いときは、準備中と伝えて
 * 入口を閉じる（設定し忘れたまま、誰でも入れる状態にしない）。
 */
const handleMypage = async (request, env) => {
    if (!isConfigured(env)) return htmlResponse(renderUnconfigured(), 503);

    const user = await readUserSession(request, env);
    if (!user) return htmlResponse(renderLogin());

    const [list, state, pending, last] = await Promise.all([
        env.DB.prepare(ACHIEVEMENT_LIST_SQL).bind(user.id).all(),
        env.DB.prepare(`SELECT value FROM sync_state WHERE key = 'achievements_synced_at'`).first(),
        env.DB.prepare(REQUEST_PENDING_FOR_USER_SQL).bind(user.id, "title").first(),
        env.DB.prepare(REQUEST_LAST_FOR_USER_SQL).bind(user.id, "title").first(),
    ]);

    return htmlResponse(
        renderMypage({
            user,
            achievements: list.results ?? [],
            syncedAt: state?.value ?? "",
            pending: toRequestView(pending),
            result: toRequestView(last),
        }),
    );
};

/**
 * マイページからの称号の着脱。
 *
 * ここでは Discord を触らない。依頼を 1 行置くだけで、反映するのは bot（30 秒ごと）。
 * 着けられるのは、自分が解放している実績だけ（bot から届いた写しで確かめる）。
 * 反映待ちのものがあるうちは、重ねて置かない（待っていることが画面に出る）。
 */
const handleTitleRequest = async (request, env) => {
    if (!isConfigured(env)) return authUnavailable();
    if (request.method !== "POST") return methodNotAllowed("POST");
    if (!isSameOrigin(request)) return forbidden();

    const user = await readUserSession(request, env);
    if (!user) return redirectTo("/mypage");

    const form = await readForm(request);
    if (form.error) return redirectTo("/mypage");

    const asked = String(form.data.get("role_id") ?? "");
    const { results } = await env.DB.prepare(ACHIEVEMENT_LIST_SQL).bind(user.id).all();
    const unlocked = (results ?? []).filter((row) => Number(row.unlocked) === 1);

    // 「外す」はいつでも通す（着けていないものを外しても害が無い）。
    // 「着ける」は、自分が解放している実績のときだけ。
    const clear = asked === "none";
    if (!clear && !unlocked.some((row) => row.id === asked)) {
        console.error("着けられない実績が指定されました", user.id, asked);
        return redirectTo("/mypage");
    }

    const parsed = toRequest({
        kind: "title",
        action: clear ? "clear" : "set",
        userId: user.id,
        roleId: clear ? "" : asked,
        source: "mypage",
    });
    if (parsed.error) return redirectTo("/mypage");

    const pending = await env.DB.prepare(REQUEST_PENDING_FOR_USER_SQL)
        .bind(user.id, "title")
        .first();
    if (pending) return redirectTo("/mypage");

    await insertRequest(env, parsed.data);

    return redirectTo("/mypage");
};

// 活動（Discord のスレッド風） -------------------------------------------------

/** URL に使う短い ID。ぶつかることはまず無いが、起きたら作り直す */
const newActivityId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 10);

/**
 * 活動 1 本のページを組み立てる。
 *
 * 見せてよくないとき（無い・承認待ちで本人でも運営でもない）は null を返す。
 * 承認待ちの活動と書き込みは、立てた本人と運営にだけ見せる（承認する前に読めるように）。
 */
const buildActivityPage = async (request, env, id, { error = "" } = {}) => {
    const row = await env.DB.prepare(ACTIVITY_ONE_SQL).bind(id).first();
    if (!row) return null;

    const [user, admin] = await Promise.all([readUserSession(request, env), isAdmin(request, env)]);
    const thread = toThread(row);
    if (!canSee(thread, user) && !admin) return null;

    const showPending = admin || Boolean(user && user.id === thread.authorId);
    const [posts, pending] = await Promise.all([
        env.DB.prepare(ACTIVITY_POSTS_SQL).bind(id).all(),
        showPending
            ? env.DB.prepare(ACTIVITY_PENDING_POSTS_SQL).bind(id).all()
            : Promise.resolve({ results: [] }),
    ]);

    return renderActivity({
        thread,
        posts: (posts.results ?? []).map(toPost),
        pendingPosts: (pending.results ?? []).map(toPost),
        viewer: user,
        isAdmin: admin,
        error,
        now: Date.now(),
    });
};

/** 活動の一覧。公開されたものだけを、最後の書き込みが新しい順に出す */
const handleActivityList = async (request, env) => {
    if (request.method !== "GET") return methodNotAllowed("GET, POST");

    const [list, user] = await Promise.all([
        env.DB.prepare(ACTIVITY_LIST_SQL).bind(ACTIVITY_LIST_MAX).all(),
        readUserSession(request, env),
    ]);

    return htmlResponse(
        renderActivityList({
            threads: (list.results ?? []).map(toThreadCard),
            now: Date.now(),
            loggedIn: Boolean(user),
        }),
    );
};

/** 活動 1 本のページ */
const handleActivityPage = async (request, env, id) => {
    if (request.method !== "GET") return methodNotAllowed("GET");

    const html = await buildActivityPage(request, env, id);

    return html ? htmlResponse(html) : htmlResponse(renderActivityMissing(), 404);
};

/** 活動を書くページ。ログインしていなければ、ログインの入口を出す */
const handleActivityNew = async (request, env) => {
    if (request.method !== "GET") return methodNotAllowed("GET");

    const user = await readUserSession(request, env);

    return htmlResponse(user ? renderActivityForm({ user }) : renderActivityLogin());
};

/**
 * 活動を立てる。
 *
 * 書けるのは Discord でログインした人だけ（誰が書いたかが分かるようにするため）。
 * 保存は承認待ちで、運営が公開してから一覧に出る。短い間に何本も立てられないよう、
 * 同じ人から 1 時間に立てられる本数を数えている。
 */
const handleActivityCreate = async (request, env) => {
    if (!isSameOrigin(request)) return forbidden();

    const user = await readUserSession(request, env);
    if (!user) return redirectTo("/activities/new");

    const form = await readForm(request);
    if (form.error) return redirectTo("/activities/new");

    const values = {
        title: String(form.data.get("title") ?? ""),
        body: String(form.data.get("body") ?? ""),
    };

    const parsed = parseThread(values);
    if (parsed.error) {
        return htmlResponse(renderActivityForm({ user, values, error: parsed.error }), 400);
    }

    const recent = await env.DB.prepare(ACTIVITY_RECENT_THREADS_SQL)
        .bind(user.id, new Date(Date.now() - 60 * 60 * 1000).toISOString())
        .first();
    if (Number(recent?.count ?? 0) >= ACTIVITY_THREADS_PER_HOUR) {
        return htmlResponse(
            renderActivityForm({
                user,
                values,
                error: `活動を立てられるのは 1 時間に ${ACTIVITY_THREADS_PER_HOUR} 本までです。少し待ってから書いてください。`,
            }),
            429,
        );
    }

    const now = new Date().toISOString();
    const bodyHtml = renderMarkdown(parsed.data.body);
    const ipHash = await hashIp(request, env);

    for (let attempt = 0; attempt < 5; attempt += 1) {
        const id = newActivityId();

        try {
            await env.DB.prepare(ACTIVITY_INSERT_SQL)
                .bind(
                    id,
                    parsed.data.title,
                    parsed.data.body,
                    bodyHtml,
                    user.id,
                    user.name,
                    user.avatar,
                    now,
                    ipHash,
                )
                .run();

            return redirectTo(`/activities/${id}`);
        } catch (error) {
            // ID がぶつかったときだけ、作り直す
            if (!String(error).includes("UNIQUE")) throw error;
        }
    }

    throw new Error("活動の ID を作れませんでした");
};

/** 活動に書き足す。書き足せるのは、その活動を立てた本人だけ */
const handleActivityPost = async (request, env, id) => {
    if (!isSameOrigin(request)) return forbidden();

    const user = await readUserSession(request, env);
    if (!user) return redirectTo("/activities/new");

    const row = await env.DB.prepare(ACTIVITY_ONE_SQL).bind(id).first();
    const thread = row ? toThread(row) : null;
    if (!thread || !canSee(thread, user) || thread.authorId !== user.id) {
        return redirectTo("/activities");
    }

    // 画面に戻して理由を出す（書き足せないまま、黙って戻さない）
    const pageWith = async (error, status) => {
        const html = await buildActivityPage(request, env, id, { error });

        return html ? htmlResponse(html, status) : redirectTo(`/activities/${id}`);
    };

    const form = await readForm(request);
    if (form.error) {
        return pageWith("書き込みを読めませんでした。もう一度お試しください。", 400);
    }

    const parsed = parsePost({ body: form.data.get("body") });
    if (parsed.error) return pageWith(parsed.error, 400);

    const [count, recent] = await Promise.all([
        env.DB.prepare(ACTIVITY_POST_COUNT_SQL).bind(id).first(),
        env.DB.prepare(ACTIVITY_RECENT_POSTS_SQL)
            .bind(user.id, new Date(Date.now() - 60 * 60 * 1000).toISOString())
            .first(),
    ]);

    if (Number(count?.count ?? 0) >= ACTIVITY_POSTS_MAX) {
        return pageWith(`1 本の活動に置ける書き込みは ${ACTIVITY_POSTS_MAX} 件までです。`, 400);
    }

    if (Number(recent?.count ?? 0) >= ACTIVITY_POSTS_PER_HOUR) {
        return pageWith(
            `書き込めるのは 1 時間に ${ACTIVITY_POSTS_PER_HOUR} 件までです。少し待ってから書いてください。`,
            429,
        );
    }

    await env.DB.prepare(ACTIVITY_POST_INSERT_SQL)
        .bind(
            id,
            parsed.data.body,
            renderMarkdown(parsed.data.body),
            user.id,
            user.name,
            user.avatar,
            new Date().toISOString(),
        )
        .run();

    return redirectTo(`/activities/${id}#posts`);
};

/** 承認ページに出す 3 つの一覧を、まとめて引く */
const adminActivityLists = async (env) => {
    const [threads, posts, recent] = await Promise.all([
        env.DB.prepare(ADMIN_PENDING_THREADS_SQL).bind(ADMIN_ACTIVITY_LIST_MAX).all(),
        env.DB.prepare(ADMIN_PENDING_POSTS_SQL).bind(ADMIN_ACTIVITY_LIST_MAX).all(),
        env.DB.prepare(ADMIN_RECENT_THREADS_SQL).bind(ADMIN_ACTIVITY_LIST_MAX).all(),
    ]);

    return {
        threads: threads.results ?? [],
        posts: posts.results ?? [],
        recent: recent.results ?? [],
    };
};

/**
 * 活動の承認。
 *
 * できるのは「公開する」「見送る」「取り下げる」だけ（本文は書き換えない）。
 * 承認・見送りのあとは、その活動の書き込みの数と「最後の書き込み」を数え直す。
 */
const handleAdminActivities = async (request, env) => {
    if (!(await isAdmin(request, env))) return redirectTo("/admin/columns");

    if (request.method === "POST") {
        if (!isSameOrigin(request)) return forbidden();

        const form = await readForm(request);
        if (form.error) return redirectTo("/admin/activities");

        const kind = String(form.data.get("kind") ?? "");
        const action = String(form.data.get("action") ?? "");
        const id = String(form.data.get("id") ?? "");
        const validKind =
            (kind === "thread" && /^[A-Za-z0-9-]{4,32}$/.test(id)) ||
            (kind === "post" && /^\d+$/.test(id));

        if (!validKind || (action !== "publish" && action !== "reject")) {
            return htmlResponse(
                renderAdminActivities({
                    ...(await adminActivityLists(env)),
                    error: "送られてきた内容を読めませんでした。",
                }),
                400,
            );
        }

        const now = new Date().toISOString();
        let activityId = id;

        if (kind === "thread") {
            if (action === "publish") {
                await env.DB.prepare(ACTIVITY_PUBLISH_SQL).bind(id, now).run();
            } else {
                await env.DB.prepare(ACTIVITY_REJECT_SQL).bind(id).run();
            }
        } else {
            const post = await env.DB.prepare(ACTIVITY_POST_ONE_SQL).bind(Number(id)).first();
            if (!post) return redirectTo("/admin/activities");

            activityId = post.activity_id;
            if (action === "publish") {
                await env.DB.prepare(ACTIVITY_POST_PUBLISH_SQL).bind(Number(id), now).run();
            } else {
                await env.DB.prepare(ACTIVITY_POST_REJECT_SQL).bind(Number(id)).run();
            }
        }

        await env.DB.prepare(ACTIVITY_REFRESH_SQL).bind(activityId).run();

        return redirectTo(`/admin/activities?done=${kind}-${action}`);
    }

    if (request.method !== "GET") return methodNotAllowed("GET, POST");

    return htmlResponse(
        renderAdminActivities({
            ...(await adminActivityLists(env)),
            done: new URL(request.url).searchParams.get("done") ?? "",
        }),
    );
};

/** Discord の認証画面へ送る。合言葉（state）をクッキーに入れて、戻ってきたときに見比べる */
const handleDiscordAuth = async (request, env) => {
    if (!isConfigured(env)) return authUnavailable();

    const state = makeState();
    // ログインし終わったあとの行き先（/activities/new など）。無ければマイページ
    const next = new URL(request.url).searchParams.get("next") ?? "";

    return redirectTo(
        buildAuthorizeUrl({
            clientId: env.DISCORD_CLIENT_ID,
            redirectUri: redirectUriOf(request),
            state,
        }),
        [buildStateCookie(buildStateValue(state, next), isSecure(request))],
    );
};

/** 認証から戻ってきた人に、入っている証を渡してマイページへ送る */
const handleDiscordCallback = async (request, env) => {
    if (!isConfigured(env)) return authUnavailable();

    const params = new URL(request.url).searchParams;
    const secure = isSecure(request);

    // 行き来の合言葉が合わないものは断る（他所から押し込まれたもの）
    if (!isSameState(request, params)) {
        return authFailed("state が合いませんでした。");
    }

    if (params.get("error")) {
        return authFailed(`Discord 側で断られました（${params.get("error")}）`);
    }

    const code = params.get("code") ?? "";
    if (!code) return authFailed("code がありませんでした。");

    const token = await exchangeCode({
        code,
        clientId: env.DISCORD_CLIENT_ID,
        clientSecret: env.DISCORD_CLIENT_SECRET,
        redirectUri: redirectUriOf(request),
    });
    if (token.error) return authFailed(token.error, 502);

    const found = await fetchUser({ accessToken: token.data.accessToken });
    if (found.error) return authFailed(found.error, 502);

    return redirectTo(nextAfterLogin(request), [
        buildUserCookie(await issueUserSession(env, found.data), secure),
        clearStateCookie(),
    ]);
};

/** 出る。証を消して、マイページへ戻す */
const handleDiscordLogout = (request) => {
    if (request.method !== "POST") return methodNotAllowed("POST");
    if (!isSameOrigin(request)) return forbidden();

    return redirectTo("/mypage", [clearUserCookie(), clearStateCookie()]);
};

/** 移動のお知らせ。クッキーを複数付けられるように Headers を組み立てる */
const redirectTo = (location, cookies = []) => {
    const headers = new Headers({ location });
    for (const cookie of cookies) headers.append("set-cookie", cookie);

    return new Response(null, { status: 303, headers });
};

/** ログインの設定が無いとき。設定し忘れたまま、誰でも入れる状態にしない */
const authUnavailable = () =>
    jsonResponse({ ok: false, message: "ログインの設定がされていません。" }, 503);

/** ログインの途中でうまくいかなかったとき。理由はログにだけ残す */
const authFailed = (reason, status = 400) => {
    console.error("ログインに失敗しました", reason);

    return htmlResponse(renderAuthError(), status);
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

// 実績の付与・剥奪（運営用） -------------------------------------------------

/**
 * 実績の付与・剥奪。
 *
 *   GET  …… 相手を選ぶ画面。相手を選ぶと、その人の実績とボタンが出る
 *   POST …… 付与・剥奪の依頼を 1 行置く（Discord に反映するのは bot）
 *
 * 合言葉で入っていない人は、コラムの承認と同じ入口（/admin/columns）へ送る。
 */
const handleAdminAchievements = async (request, env) => {
    if (!(await isAdmin(request, env))) return redirectTo("/admin/columns");

    if (request.method === "GET") {
        return htmlResponse(await renderAdminAchievementsPage(request, env));
    }
    if (request.method === "POST") return await createUnlockRequest(request, env);

    return methodNotAllowed("GET, POST");
};

/**
 * 相手を選ぶ画面の HTML。
 *
 * 「q」が Discord の ID（かメンション）なら、その人を直接開く。名前の一部なら、
 * その文字を含む人を出す。options.userId は、書き込みに失敗したときなどに
 * 同じ人をもう一度出すために使う。
 */
const renderAdminAchievementsPage = async (request, env, options = {}) => {
    const params = new URL(request.url).searchParams;
    const query = (params.get("q") ?? "").trim().slice(0, 40);
    const error = options.error ?? "";
    const userId = options.userId ?? parseUserId(params.get("user") || query);

    if (!userId) {
        const { results } = query
            ? await env.DB.prepare(MEMBER_SEARCH_SQL).bind(query).all()
            : await env.DB.prepare(MEMBER_LIST_SQL).all();

        return renderAdminAchievements({ query, members: results ?? [], error });
    }

    const [list, member, pending, last] = await Promise.all([
        env.DB.prepare(ACHIEVEMENT_LIST_SQL).bind(userId).all(),
        env.DB.prepare(MEMBER_ONE_SQL).bind(userId).first(),
        env.DB.prepare(REQUEST_PENDING_ANY_SQL).bind(userId).first(),
        env.DB.prepare(REQUEST_LAST_FOR_USER_SQL).bind(userId, "unlock").first(),
    ]);

    return renderAdminAchievements({
        query,
        userId,
        member: member ?? null,
        rows: list.results ?? [],
        pending: toRequestView(pending),
        result: toRequestView(last),
        error,
    });
};

/** 付与・剥奪の依頼を置く。置けたら、その人の画面へ戻す */
const createUnlockRequest = async (request, env) => {
    if (!isSameOrigin(request)) return forbidden();

    const form = await readForm(request);
    if (form.error) return htmlResponse(renderAdminAchievements({ error: form.error }), 400);

    const parsed = toRequest({
        kind: "unlock",
        action: String(form.data.get("action") ?? ""),
        userId: String(form.data.get("user_id") ?? ""),
        roleId: String(form.data.get("role_id") ?? ""),
        source: "admin",
    });

    if (parsed.error) {
        console.error("実績の操作を受け付けられませんでした", parsed.error);
        return htmlResponse(
            await renderAdminAchievementsPage(request, env, {
                userId: parseUserId(form.data.get("user_id")),
                error: parsed.error,
            }),
            400,
        );
    }

    // 実績の一覧に無い ID は置かない（消えたロールを、いつまでも付けようとしない）
    const known = await env.DB.prepare(`SELECT id FROM achievements WHERE id = ?1`)
        .bind(parsed.data.roleId)
        .first();

    if (!known) {
        return htmlResponse(
            await renderAdminAchievementsPage(request, env, {
                userId: parsed.data.userId,
                error: "その実績は、いまの一覧にありません。画面を開き直してください。",
            }),
            400,
        );
    }

    // 二度押しで同じ依頼が並ばないようにする（すでに待っていれば、何もしない）
    const duplicate = await env.DB.prepare(REQUEST_DUPLICATE_SQL)
        .bind(parsed.data.userId, parsed.data.roleId, parsed.data.action)
        .first();

    if (!duplicate) await insertRequest(env, parsed.data);

    return redirectTo(`/admin/achievements?user=${encodeURIComponent(parsed.data.userId)}`);
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
const sign = (env, message) => signWithKey(`admin:${env.ADMIN_PASSWORD ?? ""}`, message);

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

/** フォームを読む。壊れていても、ページを出せるようにする */
const readForm = async (request) => {
    try {
        return { data: await request.formData() };
    } catch {
        return { error: "送信された内容を読めませんでした。" };
    }
};

/** 依頼を 1 行置く（実績の付与・剥奪、称号の着脱）。反映するのは bot */
const insertRequest = (env, row) =>
    env.DB.prepare(REQUEST_INSERT_SQL)
        .bind(row.kind, row.action, row.userId, row.roleId, row.source, new Date().toISOString())
        .run();

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

const htmlResponse = (html, status = 200) =>
    new Response(html, {
        status,
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
