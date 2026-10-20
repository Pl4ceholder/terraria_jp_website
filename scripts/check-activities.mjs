// ==========================================================================
// check-activities.mjs — 活動ページ（Discord のスレッド風）を手元で確かめる
//
// 確かめるのは 4 つ。
//   1. 入力の確かめ方（worker/activities.js の parseThread / parsePost）
//   2. 公開・見送りのときに、一覧とスレッドに何が出るか
//   3. 書き込みの数と「最後の書き込み」の数え直し（ACTIVITY_REFRESH_SQL）
//   4. 承認待ちを見せる相手（canSee）と、画面に出す形
//
// 本番と同じ SQL を、本番と同じ順番で流す（立てる → 承認 → 書き足す → 承認/見送り）。
//
// 使い方: npm run check:activities
// ==========================================================================

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import {
    ACTIVITY_INSERT_SQL,
    ACTIVITY_LIMITS,
    ACTIVITY_LIST_SQL,
    ACTIVITY_ONE_SQL,
    ACTIVITY_PENDING_POSTS_SQL,
    ACTIVITY_POST_COUNT_SQL,
    ACTIVITY_POST_INSERT_SQL,
    ACTIVITY_POST_ONE_SQL,
    ACTIVITY_POST_PUBLISH_SQL,
    ACTIVITY_POST_REJECT_SQL,
    ACTIVITY_POSTS_SQL,
    ACTIVITY_PUBLISH_SQL,
    ACTIVITY_RECENT_POSTS_SQL,
    ACTIVITY_RECENT_THREADS_SQL,
    ACTIVITY_REFRESH_SQL,
    ACTIVITY_REJECT_SQL,
    ADMIN_PENDING_POSTS_SQL,
    ADMIN_PENDING_THREADS_SQL,
    ADMIN_RECENT_THREADS_SQL,
    canSee,
    parsePost,
    parseThread,
    toPost,
    toThread,
    toThreadCard,
} from "../worker/activities.js";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const AT = new Date(NOW).toISOString();
const LATER = new Date(NOW + 60 * 60 * 1000).toISOString();

const AUTHOR = { id: "1543500048245981275", name: "たろう", avatar: "https://example.com/a.png" };
const OTHER = { id: "285761788169945089", name: "はなこ", avatar: "" };

const db = new DatabaseSync(":memory:");
db.exec(readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8"));

let failed = 0;

const check = (title, ok, detail = "") => {
    if (ok) {
        console.log(`  OK   ${title}`);
    } else {
        failed += 1;
        console.log(`  ダメ  ${title}`);
        if (detail) console.log(`        ${detail}`);
    }
};

/** 活動を 1 本立てる（本番と同じ手順）。公開まで済ませることもできる */
const addThread = ({
    id,
    title = "はじめての活動",
    body = "本文です。",
    at = AT,
    author = AUTHOR,
    published = false,
}) => {
    db.prepare(ACTIVITY_INSERT_SQL).run(
        id,
        title,
        body,
        `<p>${body}</p>`,
        author.id,
        author.name,
        author.avatar,
        at,
        "ip-hash",
    );

    if (published) {
        db.prepare(ACTIVITY_PUBLISH_SQL).run(id, at);
        db.prepare(ACTIVITY_REFRESH_SQL).run(id);
    }

    return id;
};

/** 書き込みを 1 件足す（承認待ちで入る） */
const addPost = ({ activityId, at = AT, author = AUTHOR, body = "追記です。" }) =>
    Number(
        db
            .prepare(ACTIVITY_POST_INSERT_SQL)
            .run(activityId, body, `<p>${body}</p>`, author.id, author.name, author.avatar, at)
            .lastInsertRowid,
    );

const publishPost = (postId, activityId, at = AT) => {
    db.prepare(ACTIVITY_POST_PUBLISH_SQL).run(postId, at);
    db.prepare(ACTIVITY_REFRESH_SQL).run(activityId);
};

const rejectPost = (postId, activityId) => {
    db.prepare(ACTIVITY_POST_REJECT_SQL).run(postId);
    db.prepare(ACTIVITY_REFRESH_SQL).run(activityId);
};

const threadOf = (id) => toThread(db.prepare(ACTIVITY_ONE_SQL).get(id));
const cards = (limit = 50) => db.prepare(ACTIVITY_LIST_SQL).all(limit).map(toThreadCard);
const postsOf = (id) => db.prepare(ACTIVITY_POSTS_SQL).all(id).map(toPost);
const pendingPostsOf = (id) => db.prepare(ACTIVITY_PENDING_POSTS_SQL).all(id).map(toPost);

// --- 1. 入力の確かめ方 -----------------------------------------------------

check(
    "タイトルと本文を受け付ける",
    parseThread({ title: " 活動 ", body: " 本文 " }).data?.title === "活動",
);
check("前後の空白は落とす", parseThread({ title: " 活動 ", body: " 本文 " }).data?.body === "本文");
check("タイトルが空なら断る", Boolean(parseThread({ title: " ", body: "本文" }).error));
check("本文が空なら断る", Boolean(parseThread({ title: "活動", body: " " }).error));
check(
    `タイトルが ${ACTIVITY_LIMITS.title} 文字を超えたら断る`,
    Boolean(parseThread({ title: "あ".repeat(ACTIVITY_LIMITS.title + 1), body: "本文" }).error),
);
check(
    `タイトルが ${ACTIVITY_LIMITS.title} 文字ちょうどなら通る`,
    !parseThread({ title: "あ".repeat(ACTIVITY_LIMITS.title), body: "本文" }).error,
);
check(
    `本文が ${ACTIVITY_LIMITS.body} 文字を超えたら断る`,
    Boolean(parseThread({ title: "活動", body: "あ".repeat(ACTIVITY_LIMITS.body + 1) }).error),
);
check("書き足すときも、空なら断る", Boolean(parsePost({ body: "  " }).error));
check("書き足す本文は、そのまま使える", parsePost({ body: " 追記 " }).data?.body === "追記");

// --- 2. 立てただけでは、一覧に出ない ---------------------------------------

addThread({ id: "thread0001", published: false });

check("承認待ちの活動は、一覧に出ない", cards().length === 0, `件数: ${cards().length}`);
check("承認待ちの活動は、書いた本人には見える", canSee(threadOf("thread0001"), AUTHOR));
check("承認待ちの活動は、ほかの人には見えない", !canSee(threadOf("thread0001"), OTHER));
check("ログインしていない人にも見えない", !canSee(threadOf("thread0001"), null));
check(
    "承認待ちの活動は、承認ページに古い順で出る",
    db.prepare(ADMIN_PENDING_THREADS_SQL).all(10).length === 1,
);

// --- 3. 承認すると、一覧に出る ---------------------------------------------

db.prepare(ACTIVITY_PUBLISH_SQL).run("thread0001", AT);
db.prepare(ACTIVITY_REFRESH_SQL).run("thread0001");

const published = cards();
check("承認すると、一覧に出る", published.length === 1);
check(
    "最初の書き込みを 1 件として数える",
    published[0].postCount === 1,
    `件数: ${published[0].postCount}`,
);
check(
    "書いた人の名前とアイコンが付く",
    published[0].authorName === "たろう" && published[0].authorIcon !== "",
);
check(
    "本文の抜粋が付く",
    published[0].excerpt === "本文です。",
    `抜粋: ${JSON.stringify(published[0].excerpt)}`,
);
check("承認したら、ほかの人にも見える", canSee(threadOf("thread0001"), OTHER));
check("承認待ちの一覧からは消える", db.prepare(ADMIN_PENDING_THREADS_SQL).all(10).length === 0);

// --- 4. 書き足す（承認待ちのうちは出ない） ---------------------------------

const post1 = addPost({ activityId: "thread0001", at: LATER });

check("書き足しただけでは、スレッドに出ない", postsOf("thread0001").length === 0);
check("書いた本人には、承認待ちとして見える", pendingPostsOf("thread0001").length === 1);
check(
    "承認待ちのあいだは、書き込みの数が増えない",
    threadOf("thread0001").postCount === 1,
    `件数: ${threadOf("thread0001").postCount}`,
);
check(
    "承認待ちの書き込みも、数えるときは数に入る",
    db.prepare(ACTIVITY_POST_COUNT_SQL).get("thread0001").count === 1,
);
check(
    "どの活動の書き込みか、引ける（承認したあとの数え直しに使う）",
    db.prepare(ACTIVITY_POST_ONE_SQL).get(post1).activity_id === "thread0001",
);

// --- 5. 書き込みを承認する -------------------------------------------------

publishPost(post1, "thread0001", LATER);

check("承認すると、スレッドに出る", postsOf("thread0001").length === 1);
check("承認すると、承認待ちから消える", pendingPostsOf("thread0001").length === 0);
check(
    "書き込みの数が増える",
    threadOf("thread0001").postCount === 2,
    `件数: ${threadOf("thread0001").postCount}`,
);
check("最後の書き込みの時刻が、一覧の並びに使われる", cards()[0].updatedAt === LATER);
check("一覧にも、書き込みの数が出る", cards()[0].postCount === 2, `件数: ${cards()[0].postCount}`);
check("承認ページの「公開中」に出る", db.prepare(ADMIN_RECENT_THREADS_SQL).all(10).length === 1);

// --- 6. 書き込みを見送ると、数え直される -----------------------------------

const post2 = addPost({ activityId: "thread0001", at: LATER, body: "見送られる追記" });
rejectPost(post2, "thread0001");

check("見送った書き込みは、スレッドに出ない", postsOf("thread0001").length === 1);
check("見送った書き込みは、承認待ちにも残らない", pendingPostsOf("thread0001").length === 0);
check(
    "見送っても、数え直せば元の数に戻る",
    threadOf("thread0001").postCount === 2,
    `件数: ${threadOf("thread0001").postCount}`,
);
check(
    "見送ったあとの「最後の書き込み」は、残っている書き込みの時刻",
    cards().find((card) => card.id === "thread0001").updatedAt === LATER,
    `時刻: ${cards().find((card) => card.id === "thread0001").updatedAt}`,
);

// --- 7. 並び順 -------------------------------------------------------------

const YESTERDAY = new Date(NOW - 24 * 60 * 60 * 1000).toISOString();
const TWO_DAYS_AGO = new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString();
addThread({ id: "thread0002", title: "古い活動", at: YESTERDAY, published: true });

const ordered = cards();
check(
    "一覧は、最後の書き込みが新しい順",
    ordered[0].id === "thread0001" && ordered[1].id === "thread0002",
);

// --- 8. 取り下げると、一覧から消える ---------------------------------------

db.prepare(ACTIVITY_REJECT_SQL).run("thread0001");

check("取り下げると、一覧から消える", !cards().some((card) => card.id === "thread0001"));
check("取り下げても、書いた本人には見える", canSee(threadOf("thread0001"), AUTHOR));
check("取り下げたら、ほかの人には見えない", !canSee(threadOf("thread0001"), OTHER));
check(
    "取り下げた活動の書き込みは、承認待ちの一覧に出ない",
    db.prepare(ADMIN_PENDING_POSTS_SQL).all(10).length === 0,
    "公開中の活動の書き込みだけを出す",
);

// --- 9. 同じ人からの本数を数える（いたずら対策） ---------------------------

const recentThreads = db.prepare(ACTIVITY_RECENT_THREADS_SQL).get(AUTHOR.id, TWO_DAYS_AGO).count;
const recentPosts = db.prepare(ACTIVITY_RECENT_POSTS_SQL).get(AUTHOR.id, TWO_DAYS_AGO).count;

check("同じ人が立てた本数を数えられる", recentThreads === 2, `本数: ${recentThreads}`);
check("同じ人が書き込んだ数を数えられる", recentPosts === 2, `件数: ${recentPosts}`);
check(
    "その人以外は数に入らない",
    db.prepare(ACTIVITY_RECENT_THREADS_SQL).get(OTHER.id, TWO_DAYS_AGO).count === 0,
);

if (failed === 0) {
    console.log("活動の受け取りと、承認と、書き足しは、期待どおりです。");
} else {
    console.log(`${failed} 件が期待と違います。`);
    process.exitCode = 1;
}
