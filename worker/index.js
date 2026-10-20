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
//   POST /activities            活動を立てる（Discord でログインした人だけ・すぐ公開）
//   GET  /activities/<id>       活動 1 本（Discord のスレッド風）
//   POST /activities/<id>/posts 活動に書き足す（立てた本人だけ・すぐ公開）
//   GET  /activities/new        活動を書くページ
//   GET  /admin/activities      活動の管理（合言葉で入った人だけ）
//   POST /admin/activities      取り下げ・戻す
//   GET  /admin/achievements    実績の付与・剥奪（合言葉で入った人だけ）
//   POST /admin/achievements    付与・剥奪の依頼を置く（反映するのは bot）
//   GET  /auth/discord          Discord の認証画面へ送る
//   GET  /auth/discord/callback 認証から戻ってきた人に、入っている証を渡す
//   POST /auth/logout           出る
//
// コラムは誰でも投稿でき、運営が承認してから公開する。活動は書いた時点で公開する。
// 置き場所はすべて無料枠の範囲（Workers と D1）で使う。上限を超えたときは
// 「エラーになる」だけで、料金は発生しない。詳しくは README.md を参照。
// ==========================================================================

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
import { handleAdminSession, isAdmin } from "./admin-session.js";
import {
    handleActivityCreate,
    handleActivityList,
    handleActivityNew,
    handleActivityPage,
    handleActivityPost,
    handleAdminActivities,
} from "./activities-api.js";
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
import {
    handleColumnArticle,
    handleColumnList,
    handleImage,
    handlePost,
    handlePreview,
    handleUpload,
} from "./columns-api.js";
import { handleEventList, handleEventSync } from "./events-api.js";
import {
    forbidden,
    htmlResponse,
    jsonResponse,
    methodNotAllowed,
    readForm,
    readJson,
    redirectTo,
    unauthorized,
    isSameOrigin,
} from "./http.js";
import { renderNotFound } from "./html.js";
import { renderAuthError, renderLogin, renderMypage, renderUnconfigured } from "./mypage.js";
import { handleRecruitList, handleRecruitSync } from "./recruit-api.js";
import { checkSyncSecret } from "./sync.js";

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
                return await handleColumnList(env, request.url);
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

        return htmlResponse(renderNotFound(), 404);
    },
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

    const denied = checkSyncSecret(request, env);
    if (denied) return denied;

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

    const denied = checkSyncSecret(request, env);
    if (denied) return denied;

    const { results } = await env.DB.prepare(REQUEST_PENDING_SQL).bind(REQUEST_LIST_MAX).all();

    return jsonResponse({ ok: true, requests: toRequestList(results) });
};

/** bot が、依頼の結果を書き戻す。すでに処理済みのものは上書きしない */
const handleRequestResult = async (request, env, id) => {
    if (request.method !== "POST") return methodNotAllowed("POST");

    const denied = checkSyncSecret(request, env);
    if (denied) return denied;

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

/** ログインの設定が無いとき。設定し忘れたまま、誰でも入れる状態にしない */
const authUnavailable = () =>
    jsonResponse({ ok: false, message: "ログインの設定がされていません。" }, 503);

/** ログインの途中でうまくいかなかったとき。理由はログにだけ残す */
const authFailed = (reason, status = 400) => {
    console.error("ログインに失敗しました", reason);

    return htmlResponse(renderAuthError(), status);
};

// 運営（コラムの承認） -----------------------------------------------------

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

/** 依頼を 1 行置く（実績の付与・剥奪、称号の着脱）。反映するのは bot */
const insertRequest = (env, row) =>
    env.DB.prepare(REQUEST_INSERT_SQL)
        .bind(row.kind, row.action, row.userId, row.roleId, row.source, new Date().toISOString())
        .run();
