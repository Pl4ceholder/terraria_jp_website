// ==========================================================================
// activities-api.js — 活動（Discord のスレッド風）の表示・投稿・取り下げ
//
// 活動は書いた時点で公開する（承認しない）。問題があるものは運営が取り下げ、
// 取り下げられている間は、書いた本人と運営にだけ見える。
//
// 書けるのは Discord でログインした人だけ。1 本の活動に書き足せるのは、
// その活動を立てた本人だけ。
// ==========================================================================

import {
    ADMIN_ACTIVITY_LIST_MAX,
    ADMIN_HIDDEN_THREADS_SQL,
    ADMIN_PUBLISHED_THREADS_SQL,
    ACTIVITY_BUMP_SQL,
    ACTIVITY_HIDE_SQL,
    ACTIVITY_INSERT_SQL,
    ACTIVITY_LIST_MAX,
    ACTIVITY_LIST_SQL,
    ACTIVITY_ONE_SQL,
    ACTIVITY_POSTS_MAX,
    ACTIVITY_POSTS_PER_HOUR,
    ACTIVITY_POSTS_SQL,
    ACTIVITY_POST_COUNT_SQL,
    ACTIVITY_POST_INSERT_SQL,
    ACTIVITY_RECENT_POSTS_SQL,
    ACTIVITY_RECENT_THREADS_SQL,
    ACTIVITY_RESTORE_SQL,
    ACTIVITY_THREADS_PER_HOUR,
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
import { renderAdminActivities } from "./admin-activities.js";
import { hashIp, isAdmin } from "./admin-session.js";
import { readUserSession } from "./auth.js";
import {
    forbidden,
    htmlResponse,
    methodNotAllowed,
    readForm,
    redirectTo,
    isSameOrigin,
} from "./http.js";
import { renderMarkdown } from "./markdown.js";

/** URL に使う短い ID。ぶつかることはまず無いが、起きたら作り直す */
const newActivityId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 10);

/**
 * 活動 1 本のページを組み立てる。
 *
 * 見せてよくないとき（無い・取り下げられていて本人でも運営でもない）は null を返す。
 * 取り下げられた活動は、書いた本人と運営にだけ見せる（理由を伝えられるように）。
 */
const buildActivityPage = async (request, env, id, { error = "" } = {}) => {
    const row = await env.DB.prepare(ACTIVITY_ONE_SQL).bind(id).first();
    if (!row) return null;

    const [user, admin] = await Promise.all([readUserSession(request, env), isAdmin(request, env)]);
    const thread = toThread(row);
    if (!canSee(thread, user) && !admin) return null;

    const posts = await env.DB.prepare(ACTIVITY_POSTS_SQL).bind(id).all();

    return renderActivity({
        thread,
        posts: (posts.results ?? []).map(toPost),
        viewer: user,
        error,
    });
};

/** 活動の一覧。公開されたものだけを、最後の書き込みが新しい順に出す */
export const handleActivityList = async (request, env) => {
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
export const handleActivityPage = async (request, env, id) => {
    if (request.method !== "GET") return methodNotAllowed("GET");

    const html = await buildActivityPage(request, env, id);

    return html ? htmlResponse(html) : htmlResponse(renderActivityMissing(), 404);
};

/** 活動を書くページ。ログインしていなければ、ログインの入口を出す */
export const handleActivityNew = async (request, env) => {
    if (request.method !== "GET") return methodNotAllowed("GET");

    const user = await readUserSession(request, env);

    return htmlResponse(user ? renderActivityForm({ user }) : renderActivityLogin());
};

/**
 * 活動を立てる。
 *
 * 書けるのは Discord でログインした人だけ（誰が書いたかが分かるようにするため）。
 * 書いたものはそのまま公開する。短い間に何本も立てられないよう、同じ人から
 * 1 時間に立てられる本数を数えている。
 */
export const handleActivityCreate = async (request, env) => {
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
export const handleActivityPost = async (request, env, id) => {
    if (!isSameOrigin(request)) return forbidden();

    const user = await readUserSession(request, env);
    if (!user) return redirectTo("/activities/new");

    const row = await env.DB.prepare(ACTIVITY_ONE_SQL).bind(id).first();
    const thread = row ? toThread(row) : null;
    if (!thread || !canSee(thread, user) || thread.authorId !== user.id) {
        return redirectTo("/activities");
    }

    // 取り下げられている間は、書き足せない（画面にもフォームを出していない）
    if (thread.status !== "published") return redirectTo(`/activities/${id}`);

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

    const now = new Date().toISOString();

    // 書き込みと、活動側の「件数・最後の書き込み」を同じ回に進める。
    // 途中で切れても、片方だけ進んだ状態が残らない。
    await env.DB.batch([
        env.DB.prepare(ACTIVITY_POST_INSERT_SQL).bind(
            id,
            parsed.data.body,
            renderMarkdown(parsed.data.body),
            user.id,
            user.name,
            user.avatar,
            now,
        ),
        env.DB.prepare(ACTIVITY_BUMP_SQL).bind(id, now),
    ]);

    return redirectTo(`/activities/${id}#posts`);
};

/** 管理ページに出す 2 つの一覧を、まとめて引く */
const adminActivityLists = async (env) => {
    const [published, hidden] = await Promise.all([
        env.DB.prepare(ADMIN_PUBLISHED_THREADS_SQL).bind(ADMIN_ACTIVITY_LIST_MAX).all(),
        env.DB.prepare(ADMIN_HIDDEN_THREADS_SQL).bind(ADMIN_ACTIVITY_LIST_MAX).all(),
    ]);

    return {
        published: published.results ?? [],
        hidden: hidden.results ?? [],
    };
};

/**
 * 活動の取り下げ・復帰。
 *
 * 活動は書いた時点で公開されるので、ここでできるのは「取り下げる」「戻す」だけ
 * （本文は書き換えない）。取り下げても、書いた本人には見えたまま。
 */
export const handleAdminActivities = async (request, env) => {
    if (!(await isAdmin(request, env))) return redirectTo("/admin/columns");

    if (request.method === "POST") {
        if (!isSameOrigin(request)) return forbidden();

        const form = await readForm(request);
        if (form.error) return redirectTo("/admin/activities");

        const action = String(form.data.get("action") ?? "");
        const id = String(form.data.get("id") ?? "");
        const validId = /^[A-Za-z0-9-]{4,32}$/.test(id);

        if (!validId || (action !== "hide" && action !== "restore")) {
            return htmlResponse(
                renderAdminActivities({
                    ...(await adminActivityLists(env)),
                    error: "送られてきた内容を読めませんでした。",
                }),
                400,
            );
        }

        await env.DB.prepare(action === "hide" ? ACTIVITY_HIDE_SQL : ACTIVITY_RESTORE_SQL)
            .bind(id)
            .run();

        return redirectTo(`/admin/activities?done=thread-${action}`);
    }

    if (request.method !== "GET") return methodNotAllowed("GET, POST");

    return htmlResponse(
        renderAdminActivities({
            ...(await adminActivityLists(env)),
            done: new URL(request.url).searchParams.get("done") ?? "",
        }),
    );
};
