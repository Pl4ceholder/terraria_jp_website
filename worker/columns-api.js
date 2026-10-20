// ==========================================================================
// columns-api.js — コラムの表示・投稿・画像
//
// コラムは誰でも投稿でき、運営が承認してから公開する。記事の本文は Markdown
// で受け取り、保存するときに HTML も作っておく（表示のたびに作り直さない）。
//
// 画像は D1 の images に入れる。R2 などの有料の置き場所は使わない。
// 上限を超えたときは「エラーになる」だけで、料金は発生しない。
// ==========================================================================

import { hashIp } from "./admin-session.js";
import { htmlResponse, jsonResponse, methodNotAllowed, readJson } from "./http.js";
import { renderArticle, renderList, renderNotFound } from "./html.js";
import { renderMarkdown } from "./markdown.js";

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

/** 一覧。公開されたものだけを、新しい順に出す */
export const handleColumnList = async (env) => {
    const { results } = await env.DB.prepare(
        `SELECT slug, title, body_md, author, tags, published_at, created_at
           FROM columns
          WHERE status = 'published'
          ORDER BY COALESCE(published_at, created_at) DESC, title ASC`,
    ).all();

    return htmlResponse(renderList((results ?? []).map(toColumn)));
};

/** 記事 1 件。公開されていないものは、あったこと自体を出さない */
export const handleColumnArticle = async (env, slug) => {
    const row = await env.DB.prepare(
        `SELECT slug, title, body_md, body_html, author, tags, published_at, created_at
           FROM columns
          WHERE slug = ?1 AND status = 'published'`,
    )
        .bind(slug)
        .first();

    if (!row) return htmlResponse(renderNotFound(), 404);

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

/** 書いた文章の下見。保存はしない */
export const handlePreview = async (request) => {
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
export const handlePost = async (request, env) => {
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

    // 日本語だけのタイトルだと 1 文字しか残ることがある。短いときは column にする。
    const name = base.length >= 3 ? base : "column";

    return `${name}-${crypto.randomUUID().replace(/-/g, "").slice(0, 6)}`;
};

/** 画像を受け取って D1 に入れる */
export const handleUpload = async (request, env) => {
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
export const handleImage = async (id, env) => {
    const row = await env.DB.prepare(`SELECT content_type, data FROM images WHERE id = ?1`)
        .bind(id)
        .first();

    if (!row) return new Response("Not found", { status: 404 });

    return new Response(toBytes(row.data), {
        headers: {
            "content-type": row.content_type,
            "cache-control": "public, max-age=31536000, immutable",
        },
    });
};
