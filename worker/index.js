// ==========================================================================
// index.js — Cloudflare Workers の入口
//
// 役割は 2 つだけ。
//   1. 手書きのページ（public/ の中身）…… これは Cloudflare が直接返す
//   2. それ以外の動くページと API …… ここで組み立てて返す
//
// 動くページ・API は次のとおり。
//   GET  /columns.html          コラムの一覧（公開されたものだけ）
//   GET  /columns/<slug>.html   コラムの記事
//   GET  /img/<key>             記事の画像（R2 から返す）
//   POST /api/preview           書いた文章の下見（Markdown → HTML）
//   POST /api/columns           コラムの投稿（承認待ちで保存）
//   POST /api/images            画像のアップロード
//   POST /api/admin/...         運営の操作（承認・削除）
//
// 投稿は誰でもできる。公開は運営が承認したものだけ。
// ==========================================================================

import { renderMarkdown, buildExcerpt } from "./markdown.js";
import { renderArticle, renderList, renderNotFound } from "./html.js";

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

/** 画像の条件 */
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_EXTENSIONS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
};

/** 同じ人から 1 時間に上がる画像の数（置き場所を荒らされないため） */
const IMAGES_PER_HOUR = 20;

/** 運営のログイン（合言葉）の決まりごと */
const ADMIN_COOKIE = "admin_session";
const SESSION_HOURS = 12;
const LOGIN_FAILURES = 5;
const LOGIN_WINDOW_MINUTES = 10;

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

            if (path === "/columns.html" || path === "/columns/") {
                return await handleColumnList(env);
            }

            const article = path.match(/^\/columns\/([^/]+)\.html$/);
            if (article) return await handleColumnArticle(env, article[1]);
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

/** 画像を受け取って R2 に置く */
const handleUpload = async (request, env) => {
    if (request.method !== "POST") return methodNotAllowed("POST");

    const form = await request.formData();
    const file = form.get("image");

    if (!file || typeof file === "string") {
        return jsonResponse({ ok: false, message: "画像が選ばれていません。" }, 400);
    }

    const extension = IMAGE_EXTENSIONS[file.type];
    if (!extension) {
        return jsonResponse(
            { ok: false, message: "PNG / JPEG / GIF / WebP の画像を選んでください。" },
            415,
        );
    }

    if (file.size > IMAGE_MAX_BYTES) {
        return jsonResponse({ ok: false, message: "画像は 5MB までです。" }, 413);
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

    const key = `columns/${new Date().toISOString().slice(0, 7)}/${crypto
        .randomUUID()
        .replace(/-/g, "")}.${extension}`;

    // 数えた記録を残す。ついでに 1 日より古い記録は片付ける。
    await env.DB.batch([
        env.DB.prepare(`DELETE FROM uploads WHERE created_at < ?1`).bind(
            new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        ),
        env.DB.prepare(`INSERT INTO uploads (id, ip_hash, created_at) VALUES (?1, ?2, ?3)`).bind(
            crypto.randomUUID(),
            ipHash,
            new Date().toISOString(),
        ),
    ]);

    await env.IMAGES.put(key, await file.arrayBuffer(), {
        httpMetadata: { contentType: file.type },
    });

    return jsonResponse({ ok: true, url: `/img/${key}` });
};

/** 記事で使う画像を返す */
const handleImage = async (key, env) => {
    const object = await env.IMAGES.get(key);
    if (!object) {
        return new Response("Not found", { status: 404 });
    }

    return new Response(object.body, {
        headers: {
            "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
            "cache-control": "public, max-age=31536000, immutable",
            etag: object.httpEtag,
        },
    });
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
