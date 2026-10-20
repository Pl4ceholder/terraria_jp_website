// ==========================================================================
// check-activities.mjs — 活動ページ（Discord のスレッド風）を手元で確かめる
//
// 確かめるのは 5 つ。
//   1. 入力の確かめ方（worker/activities.js の parseThread / parsePost）
//   2. 立てた活動が、そのまま一覧とスレッドに出る（承認はしない）
//   3. 書き足すと、件数と「最後の書き込み」が進む（ACTIVITY_BUMP_SQL）
//   4. 取り下げ・復帰と、見られる相手（canSee）
//   5. Markdown（画像・危ない行き先）と、画面に出す形
//
// 本番と同じ SQL を、本番と同じ順番で流す（立てる → 書き足す → 取り下げ → 戻す）。
//
// 使い方: npm run check:activities
// ==========================================================================

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import {
    ACTIVITY_BUMP_SQL,
    ACTIVITY_HIDE_SQL,
    ACTIVITY_INSERT_SQL,
    ACTIVITY_LIMITS,
    ACTIVITY_LIST_SQL,
    ACTIVITY_ONE_SQL,
    ACTIVITY_POSTS_MAX,
    ACTIVITY_POSTS_SQL,
    ACTIVITY_POST_COUNT_SQL,
    ACTIVITY_POST_INSERT_SQL,
    ACTIVITY_RECENT_POSTS_SQL,
    ACTIVITY_RECENT_THREADS_SQL,
    ACTIVITY_RESTORE_SQL,
    ADMIN_HIDDEN_THREADS_SQL,
    ADMIN_PUBLISHED_THREADS_SQL,
    canSee,
    parsePost,
    parseThread,
    toPost,
    toThread,
    toThreadCard,
} from "../worker/activities.js";
import { renderActivity, renderActivityForm } from "../worker/activity.js";
import { renderMarkdown } from "../worker/markdown.js";

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

/** 活動を 1 本立てる（本番と同じ手順。そのまま公開される） */
const addThread = ({
    id,
    title = "はじめての活動",
    body = "本文です。",
    at = AT,
    author = AUTHOR,
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

    return id;
};

/** 書き込みを 1 件足す（本番と同じく、活動側の件数も同じ回に進める） */
const addPost = ({ activityId, at = AT, author = AUTHOR, body = "追記です。" }) => {
    const id = Number(
        db
            .prepare(ACTIVITY_POST_INSERT_SQL)
            .run(activityId, body, `<p>${body}</p>`, author.id, author.name, author.avatar, at)
            .lastInsertRowid,
    );

    db.prepare(ACTIVITY_BUMP_SQL).run(activityId, at);

    return id;
};

const threadOf = (id) => toThread(db.prepare(ACTIVITY_ONE_SQL).get(id));
const cards = (limit = 50) => db.prepare(ACTIVITY_LIST_SQL).all(limit).map(toThreadCard);
const postsOf = (id) => db.prepare(ACTIVITY_POSTS_SQL).all(id).map(toPost);

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

// --- 2. 立てた活動は、そのまま公開される -----------------------------------

addThread({ id: "thread0001" });

const created = cards();
check("立てた活動が、すぐ一覧に出る", created.length === 1, `件数: ${created.length}`);
check(
    "最初の書き込みを 1 件として数える",
    created[0].postCount === 1,
    `件数: ${created[0].postCount}`,
);
check(
    "書いた人の名前とアイコンが付く",
    created[0].authorName === "たろう" && created[0].authorIcon !== "",
);
check(
    "本文の抜粋が付く",
    created[0].excerpt === "本文です。",
    `抜粋: ${JSON.stringify(created[0].excerpt)}`,
);
check("公開した日時が入る", threadOf("thread0001").publishedAt === AT);
check("ほかの人にも見える", canSee(threadOf("thread0001"), OTHER));
check("ログインしていない人にも見える", canSee(threadOf("thread0001"), null));
check(
    "書き込みが無くても、スレッドには最初の書き込みが出る",
    postsOf("thread0001").length === 0 && threadOf("thread0001").postCount === 1,
);

// --- 3. 書き足すと、すぐ出る -----------------------------------------------

addPost({ activityId: "thread0001", at: LATER });

check("書き足すと、スレッドに出る", postsOf("thread0001").length === 1);
check("書き足すと、件数が増える", threadOf("thread0001").postCount === 2);
check("最後の書き込みの時刻が、一覧の並びに使われる", cards()[0].updatedAt === LATER);
check("一覧にも、書き込みの数が出る", cards()[0].postCount === 2, `件数: ${cards()[0].postCount}`);
check(
    "書き込みの数を数えられる",
    db.prepare(ACTIVITY_POST_COUNT_SQL).get("thread0001").count === 1,
);
check(
    "1 本に置ける書き込みの上限がある",
    ACTIVITY_POSTS_MAX >= 1 && Number.isInteger(ACTIVITY_POSTS_MAX),
    `上限: ${ACTIVITY_POSTS_MAX}`,
);

// --- 4. 並び順 -------------------------------------------------------------

const YESTERDAY = new Date(NOW - 24 * 60 * 60 * 1000).toISOString();
addThread({ id: "thread0002", title: "古い活動", at: YESTERDAY });

const ordered = cards();
check(
    "一覧は、最後の書き込みが新しい順",
    ordered[0].id === "thread0001" && ordered[1].id === "thread0002",
);

// --- 5. 取り下げと復帰 -----------------------------------------------------

db.prepare(ACTIVITY_HIDE_SQL).run("thread0001");

check("取り下げると、一覧から消える", !cards().some((card) => card.id === "thread0001"));
check("取り下げても、書いた本人には見える", canSee(threadOf("thread0001"), AUTHOR));
check("取り下げたら、ほかの人には見えない", !canSee(threadOf("thread0001"), OTHER));
check(
    "管理ページの「取り下げた活動」に出る",
    db.prepare(ADMIN_HIDDEN_THREADS_SQL).all(10).length === 1,
);
check(
    "管理ページの「公開中」からは消える",
    !db
        .prepare(ADMIN_PUBLISHED_THREADS_SQL)
        .all(10)
        .some((row) => row.id === "thread0001"),
);

db.prepare(ACTIVITY_RESTORE_SQL).run("thread0001");

check(
    "戻すと、また一覧に出る",
    cards().some((card) => card.id === "thread0001"),
);
check(
    "戻すと、「取り下げた活動」から消える",
    db.prepare(ADMIN_HIDDEN_THREADS_SQL).all(10).length === 0,
);
check("戻すと、「公開中」に並ぶ", db.prepare(ADMIN_PUBLISHED_THREADS_SQL).all(10).length === 2);

// --- 6. 同じ人からの本数を数える（いたずら対策） ---------------------------

const recentThreads = db
    .prepare(ACTIVITY_RECENT_THREADS_SQL)
    .get(AUTHOR.id, new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString()).count;
const recentPosts = db
    .prepare(ACTIVITY_RECENT_POSTS_SQL)
    .get(AUTHOR.id, new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString()).count;

check("同じ人が立てた本数を数えられる", recentThreads === 2, `本数: ${recentThreads}`);
check("同じ人が書き込んだ数を数えられる", recentPosts === 1, `件数: ${recentPosts}`);
check(
    "その人以外は数に入らない",
    db
        .prepare(ACTIVITY_RECENT_THREADS_SQL)
        .get(OTHER.id, new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString()).count === 0,
);

// --- 7. Markdown（画像・危ない行き先） -------------------------------------

// 承認制だったころの「承認待ち」は、いまも出さない（デプロイ時に見えないように）
db.prepare(
    `INSERT INTO activity_posts
         (activity_id, body_md, body_html, author_id, author_name, author_icon,
          status, created_at, published_at)
     VALUES ('thread0001', '古い承認待ち', '<p>古い承認待ち</p>', ?, 'たろう', '',
             'pending', ?, NULL)`,
).run(AUTHOR.id, LATER);
check("承認制だったころの承認待ちは、出さない", postsOf("thread0001").length === 1);

const withImage = renderMarkdown("![スクリーンショット](/img/abc123)");
check(
    "画像を Markdown で置ける",
    withImage.includes('<img src="/img/abc123"') && withImage.includes('alt="スクリーンショット"'),
    withImage,
);
check(
    "見出し・太字・箇条書きが使える",
    renderMarkdown("## 見出し\n\n**太字**\n\n- 箇条書き").includes("<h2>見出し</h2>"),
);

const unsafeLink = renderMarkdown("[押す](javascript:alert(1))");
check(
    "javascript: のリンクは、そのまま通さない",
    !unsafeLink.includes("javascript:") && unsafeLink.includes('href="#"'),
    unsafeLink,
);

const unsafeImage = renderMarkdown("![a](javascript:alert(1))");
check("javascript: の画像も、そのまま通さない", !unsafeImage.includes("javascript:"), unsafeImage);
check(
    "生の HTML は、文字として出る",
    renderMarkdown("<script>alert(1)</script>").includes("&lt;script&gt;"),
);

// --- 8. 画面に出す形 -------------------------------------------------------

const form = renderActivityForm({ user: AUTHOR });
check("書くページに、下見の置き場がある", form.includes("data-activity-preview"));
check("書くページに、画像を上げる入口がある", form.includes("data-activity-image"));
check("書くページに、動きの読み込みがある", form.includes("/assets/js/pages/activity.js"));
check("書くページは「すぐ公開」と伝える", form.includes("すぐに公開されます"));
check("書くページに「承認」の文字は無い", !form.includes("承認"));

const thread = threadOf("thread0001");
const page = renderActivity({ thread, posts: postsOf("thread0001"), viewer: AUTHOR });
check("本人には、書き足すフォームが出る", page.includes("data-activity-form"));
check("書き足すフォームにも、下見がある", page.includes("data-activity-preview"));
check("書き足すと「すぐ出る」と伝える", page.includes("書き込むと、すぐにこのページに出ます"));

db.prepare(ACTIVITY_HIDE_SQL).run("thread0001");
const hiddenPage = renderActivity({
    thread: threadOf("thread0001"),
    posts: postsOf("thread0001"),
    viewer: AUTHOR,
});
check("取り下げた活動は、本人に理由を出す", hiddenPage.includes("運営が取り下げています"));
check("取り下げられている間は、書き足せない", !hiddenPage.includes("data-activity-form"));
check("取り下げた活動は、検索から入れない", hiddenPage.includes('name="robots" content="noindex"'));

if (failed === 0) {
    console.log("活動の受け取り・公開・書き足し・取り下げは、期待どおりです。");
} else {
    console.log(`${failed} 件が期待と違います。`);
    process.exitCode = 1;
}
