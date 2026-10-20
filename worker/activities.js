// ==========================================================================
// activities.js — 「活動ページ」の決まりごと
//
// 活動は、Discord のスレッドに近い形にしている。
//   1 本の活動（スレッド）…… タイトル + 最初の書き込み
//   あとから書き足せる …… activity_posts（本人だけ）
//
// 書けるのは Discord でログインした人だけ。誰が書いたかが分かるので、荒らされた
// ときの手当てが早い。書いたものはそのまま公開し、問題があったときだけ運営が
// 取り下げる（承認はしない）。
//
// 画面の組み立ては activity.js、保存の SQL と入力の検証はここに置く。
// ==========================================================================

import { buildExcerpt } from "./markdown.js";

/** 入力できる長さの上限 */
export const ACTIVITY_LIMITS = {
    title: 80,
    body: 20_000,
};

/** 1 本の活動に置ける書き込みの数（最初の書き込みを含む） */
export const ACTIVITY_POSTS_MAX = 200;

/** 同じ人が 1 時間に立てられる活動と、書き込める数（いたずら対策） */
export const ACTIVITY_THREADS_PER_HOUR = 5;
export const ACTIVITY_POSTS_PER_HOUR = 30;

/** 一覧・管理画面に出す本数 */
export const ACTIVITY_LIST_MAX = 50;
export const ADMIN_ACTIVITY_LIST_MAX = 30;

/** 一覧に出す、本文の抜粋の長さ */
const EXCERPT_MAX = 120;

const trimText = (value) => String(value ?? "").trim();

/** 新しい活動の入力を確かめる。問題があれば、そのまま画面に出せる文を返す */
export const parseThread = (input) => {
    const title = trimText(input?.title);
    if (!title) return { error: "タイトルを入れてください。" };
    if (title.length > ACTIVITY_LIMITS.title) {
        return { error: `タイトルは ${ACTIVITY_LIMITS.title} 文字までです。` };
    }

    const body = trimText(input?.body);
    if (!body) return { error: "本文を入れてください。" };
    if (body.length > ACTIVITY_LIMITS.body) {
        return { error: `本文は ${ACTIVITY_LIMITS.body} 文字までです。` };
    }

    return { data: { title, body } };
};

/** 書き足すときの入力を確かめる */
export const parsePost = (input) => {
    const body = trimText(input?.body);
    if (!body) return { error: "書き込む内容を入れてください。" };
    if (body.length > ACTIVITY_LIMITS.body) {
        return { error: `本文は ${ACTIVITY_LIMITS.body} 文字までです。` };
    }

    return { data: { body } };
};

/**
 * その活動を、この人が見てよいか。
 *
 * 公開されたものは誰でも見られる。取り下げられたものは、書いた本人だけが
 * 見られる（運営が見られるかどうかは、呼ぶ側で別に判定する）。
 */
export const canSee = (thread, viewer) =>
    thread.status === "published" || Boolean(viewer && viewer.id === thread.authorId);

/** 一覧に出す 1 件 */
export const toThreadCard = (row) => ({
    id: row.id,
    title: row.title,
    authorName: row.author_name || "名前なし",
    authorIcon: row.author_icon || "",
    createdAt: row.created_at,
    // 書き込みがあれば、その時刻。無ければ公開した時刻（どちらも無ければ作成）
    updatedAt: row.updated_at || row.published_at || row.created_at,
    postCount: Math.max(1, Number(row.post_count ?? 1)),
    excerpt: buildExcerpt(row.body_md, EXCERPT_MAX),
});

/** 活動のページに出す 1 本 */
export const toThread = (row) => ({
    id: row.id,
    title: row.title,
    bodyHtml: row.body_html,
    authorId: row.author_id,
    authorName: row.author_name || "名前なし",
    authorIcon: row.author_icon || "",
    status: row.status,
    createdAt: row.created_at,
    publishedAt: row.published_at || "",
    postCount: Math.max(1, Number(row.post_count ?? 1)),
});

/** 書き込み 1 件 */
export const toPost = (row) => ({
    id: Number(row.id),
    bodyHtml: row.body_html,
    authorName: row.author_name || "名前なし",
    authorIcon: row.author_icon || "",
    createdAt: row.created_at,
});

/** 一覧に出す、公開された活動（最後の書き込みが新しい順） */
export const ACTIVITY_LIST_SQL = `
    SELECT id, title, body_md, author_name, author_icon, created_at, published_at,
           updated_at, post_count
      FROM activities
     WHERE status = 'published'
     ORDER BY updated_at DESC, id DESC
     LIMIT ?1
`;

/** 活動 1 本（取り下げられていても引く。見せるかどうかは canSee で決める） */
export const ACTIVITY_ONE_SQL = `
    SELECT id, title, body_html, author_id, author_name, author_icon, status,
           created_at, published_at, updated_at, post_count
      FROM activities
     WHERE id = ?1
`;

/** その活動の書き込み（古い順。書き込みはすべて、書いた時点で公開） */
export const ACTIVITY_POSTS_SQL = `
    SELECT id, body_html, author_name, author_icon, created_at
      FROM activity_posts
     WHERE activity_id = ?1
     ORDER BY id
`;

/** 書き込みの数（1 本に置ける数の上限を判定する） */
export const ACTIVITY_POST_COUNT_SQL = `
    SELECT COUNT(*) AS count FROM activity_posts WHERE activity_id = ?1
`;

/** 同じ人が 1 時間に立てた活動の数 */
export const ACTIVITY_RECENT_THREADS_SQL = `
    SELECT COUNT(*) AS count
      FROM activities
     WHERE author_id = ?1 AND created_at > ?2
`;

/** 同じ人が 1 時間に書き込んだ数 */
export const ACTIVITY_RECENT_POSTS_SQL = `
    SELECT COUNT(*) AS count
      FROM activity_posts
     WHERE author_id = ?1 AND created_at > ?2
`;

/** 新しい活動を 1 本置く（最初の書き込みも同じ行に入れる。そのまま公開） */
export const ACTIVITY_INSERT_SQL = `
    INSERT INTO activities
         (id, title, body_md, body_html, author_id, author_name, author_icon,
          status, created_at, published_at, updated_at, post_count, ip_hash)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'published', ?8, ?8, ?8, 1, ?9)
`;

/** 書き込みを 1 件足す（そのまま公開） */
export const ACTIVITY_POST_INSERT_SQL = `
    INSERT INTO activity_posts
         (activity_id, body_md, body_html, author_id, author_name, author_icon,
          status, created_at, published_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'published', ?7, ?7)
`;

/**
 * 書き込みが増えたことを、活動の側に写す。
 *
 * 一覧の並びと「何件の書き込み」は activities の列を見ているので、
 * 書き込みを足したら同じ回にここも進める（数え直さなくてよい）。
 */
export const ACTIVITY_BUMP_SQL = `
    UPDATE activities
       SET post_count = post_count + 1,
           updated_at = ?2
     WHERE id = ?1
`;

/** 公開中の活動（運営が取り下げるのに使う。最後の書き込みが新しい順） */
export const ADMIN_PUBLISHED_THREADS_SQL = `
    SELECT id, title, body_md, author_name, post_count, updated_at
      FROM activities
     WHERE status = 'published'
     ORDER BY updated_at DESC, id DESC
     LIMIT ?1
`;

/** 取り下げられた活動（運営が戻すのに使う。新しい順） */
export const ADMIN_HIDDEN_THREADS_SQL = `
    SELECT id, title, body_md, author_name, post_count, updated_at
      FROM activities
     WHERE status = 'hidden'
     ORDER BY updated_at DESC, id DESC
     LIMIT ?1
`;

/** 活動を取り下げる（一覧から下げる。本人には見えたまま） */
export const ACTIVITY_HIDE_SQL = `
    UPDATE activities SET status = 'hidden' WHERE id = ?1
`;

/** 取り下げを戻す（また一覧に並ぶ） */
export const ACTIVITY_RESTORE_SQL = `
    UPDATE activities SET status = 'published' WHERE id = ?1
`;
