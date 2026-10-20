// ==========================================================================
// check-requests.mjs — Web からの依頼（実績の付与・称号の着脱）を手元で確かめる
//
// 確かめるのは 3 つ。
//   1. 依頼の中身の確かめ方（worker/requests.js の toRequest / toResult）
//   2. 保存・取り出し・書き戻しの順番（同じファイルの SQL）
//   3. bot に渡す形と、画面に出す形（toRequestList / toRequestView）
//
// 本番と同じ順番で流す（置く → bot が拾う → 結果を書き戻す → 画面が読む → 片付ける）。
// SQL も確かめ方も本番と同じものを使うので、ここが通れば本番でも同じ結果になる。
//
// 使い方: npm run check:requests
// ==========================================================================

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import {
    isExpired,
    parseUserId,
    REQUEST_CLEANUP_SQL,
    REQUEST_DUPLICATE_SQL,
    REQUEST_FINISH_SQL,
    REQUEST_INSERT_SQL,
    REQUEST_LAST_FOR_USER_SQL,
    REQUEST_LIST_MAX,
    REQUEST_PENDING_ANY_SQL,
    REQUEST_PENDING_FOR_USER_SQL,
    REQUEST_PENDING_SQL,
    REQUEST_TTL_MINUTES,
    toRequest,
    toRequestList,
    toRequestView,
    toResult,
} from "../worker/requests.js";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const AT = new Date(NOW).toISOString();

const USER_A = "1543500048245981275";
const USER_B = "285761788169945089";
const USER_C = "379981477363974144";

const db = new DatabaseSync(":memory:");
db.exec(readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8"));

const insertStatement = db.prepare(REQUEST_INSERT_SQL);
const finishStatement = db.prepare(REQUEST_FINISH_SQL);

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

/** 依頼を 1 件置く（本番と同じ手順）。断られたら理由を返す */
const put = (payload, at = AT) => {
    const parsed = toRequest(payload);
    if (parsed.error) return parsed.error;

    insertStatement.run(
        parsed.data.kind,
        parsed.data.action,
        parsed.data.userId,
        parsed.data.roleId,
        parsed.data.source,
        at,
    );

    return "";
};

/** bot が拾う依頼（古い順） */
const pending = (limit = REQUEST_LIST_MAX) =>
    toRequestList(db.prepare(REQUEST_PENDING_SQL).all(limit));

/** bot が結果を書き戻す。書き換わった行数を返す */
const finish = (id, payload) => {
    const parsed = toResult(payload);
    if (parsed.error) return parsed.error;

    return finishStatement.run(parsed.data.status, AT, parsed.data.message, id).changes;
};

// --- 1. 依頼の中身の確かめ方 -----------------------------------------------

const requests = [
    {
        kind: "title",
        action: "set",
        userId: USER_A,
        roleId: "111111111111111111",
        source: "mypage",
    },
    { kind: "title", action: "clear", userId: USER_A, roleId: "", source: "mypage" },
    {
        kind: "unlock",
        action: "grant",
        userId: USER_B,
        roleId: "222222222222222222",
        source: "admin",
    },
    {
        kind: "unlock",
        action: "revoke",
        userId: USER_B,
        roleId: "333333333333333333",
        source: "admin",
    },
];

for (const request of requests) {
    const message = put(request);
    check(`${request.kind} / ${request.action} を受け付ける`, message === "", message);
}

// 「外す」はロール ID を持たない（持っていても無視する）
check(
    "称号を外すときは、ロール ID が無くても通る",
    put({ kind: "title", action: "clear", userId: USER_C, roleId: "", source: "mypage" }) === "",
);

// --- 2. bot に渡す形 -------------------------------------------------------

const list = pending();

check("置いた依頼が、古い順に出る", list.length === 5, `件数: ${list.length}`);
check(
    "bot に渡す形になっている",
    JSON.stringify(list[0]) ===
        JSON.stringify({
            id: list[0].id,
            kind: "title",
            action: "set",
            userId: USER_A,
            roleId: "111111111111111111",
            requestedAt: AT,
        }),
    JSON.stringify(list[0]),
);
check("まだ処理していないものだけが出る（status は渡さない）", !("status" in list[0]));

// --- 3. 結果の書き戻し -----------------------------------------------------

const first = list[0].id;

check(
    "反映したことを書き戻せる",
    finish(first, { status: "done", message: "反映しました。" }) === 1,
);
check("書き戻したものは、もう拾われない", !pending().some((request) => request.id === first));
check(
    "二度目の書き戻しは効かない（上書きしない）",
    finish(first, { status: "failed", message: "あとから失敗にしない" }) === 0,
);

const rest = pending();
check(
    "失敗の理由も書き戻せる",
    finish(rest[0].id, { status: "failed", message: "Bot の権限が足りません。" }) === 1,
);

// --- 4. 画面に出す形 -------------------------------------------------------

const last = db.prepare(REQUEST_LAST_FOR_USER_SQL).get(USER_A, "title");
check(
    "その人の最後の結果を引ける（いちばん新しいもの）",
    last.action === "clear" &&
        last.status === "failed" &&
        last.message === "Bot の権限が足りません。",
    JSON.stringify(last),
);
check(
    "結果を、画面に出す形にできる",
    toRequestView(last).status === "failed" && toRequestView(last).finishedAt === AT,
    JSON.stringify(toRequestView(last)),
);
check("依頼が無いときは null", toRequestView(undefined) === null);

const waiting = db.prepare(REQUEST_PENDING_FOR_USER_SQL).all(USER_B, "unlock");
check(
    "その人の、まだ処理していない依頼だけ引ける",
    waiting.length === 2,
    `件数: ${waiting.length}`,
);
check(
    "種類が違うものは混ざらない",
    db.prepare(REQUEST_PENDING_FOR_USER_SQL).all(USER_B, "title").length === 0,
);
check(
    "種類を問わずに引ける（管理画面用）",
    db.prepare(REQUEST_PENDING_ANY_SQL).get(USER_B).action === "grant",
);

// --- 5. 二度押し -----------------------------------------------------------

check(
    "同じ依頼がすでに待っているのが分かる",
    Boolean(db.prepare(REQUEST_DUPLICATE_SQL).get(USER_B, "222222222222222222", "grant")),
);
check(
    "操作が違えば、待っているとは見なさない",
    !db.prepare(REQUEST_DUPLICATE_SQL).get(USER_B, "222222222222222222", "revoke"),
);

// --- 6. 古すぎる依頼 -------------------------------------------------------

check("5 分前の依頼は、まだ当てる", !isExpired(new Date(NOW - 5 * 60 * 1000).toISOString(), NOW));
check(
    `10 分を過ぎた依頼は、当てない`,
    isExpired(new Date(NOW - (REQUEST_TTL_MINUTES + 1) * 60 * 1000).toISOString(), NOW),
);
check("日時が壊れていたら、当てない", isExpired("いつか", NOW));

// --- 7. 片付け -------------------------------------------------------------

// 8 日前に処理した依頼と、同じくらい前に置いたままの依頼を用意する
const old = new Date(NOW - 8 * 24 * 60 * 60 * 1000).toISOString();
const oldDone = insertStatement.run(
    "unlock",
    "grant",
    USER_C,
    "444444444444444444",
    "admin",
    old,
).lastInsertRowid;
finishStatement.run("done", old, "反映しました。", oldDone);
const oldPending = insertStatement.run(
    "unlock",
    "grant",
    USER_C,
    "555555555555555555",
    "admin",
    old,
).lastInsertRowid;

const removed = db
    .prepare(REQUEST_CLEANUP_SQL)
    .run(new Date(NOW - 7 * 24 * 60 * 60 * 1000).toISOString()).changes;

check("古い依頼は片付ける（処理済みだけ）", removed === 1, `消した数: ${removed}`);
check(
    "古くても、まだ処理していない依頼は残す",
    Boolean(db.prepare(`SELECT id FROM achievement_requests WHERE id = ?1`).get(oldPending)),
);
check(
    "片付けた依頼は、その人からは引けない",
    !db.prepare(REQUEST_LAST_FOR_USER_SQL).get(USER_C, "unlock"),
);

// --- 8. 断るべきもの -------------------------------------------------------

const rejects = [
    { title: "知らない種類", payload: { kind: "role", action: "grant", userId: USER_A } },
    {
        title: "種類と合わない操作（称号を付与）",
        payload: { kind: "title", action: "grant", userId: USER_A, roleId: "1" },
    },
    {
        title: "種類と合わない操作（実績を着ける）",
        payload: { kind: "unlock", action: "set", userId: USER_A, roleId: "1" },
    },
    {
        title: "ユーザー ID が数字でない",
        payload: { kind: "unlock", action: "grant", userId: "taro", roleId: "111111111111111111" },
    },
    {
        title: "ユーザー ID が短すぎる",
        payload: { kind: "unlock", action: "grant", userId: "12345", roleId: "111111111111111111" },
    },
    {
        title: "ロール ID が無い",
        payload: { kind: "unlock", action: "grant", userId: USER_A, roleId: "" },
    },
    {
        title: "ロール ID が数字でない",
        payload: { kind: "unlock", action: "grant", userId: USER_A, roleId: "実績A" },
    },
    {
        title: "出どころが無い",
        payload: {
            kind: "unlock",
            action: "grant",
            userId: USER_A,
            roleId: "111111111111111111",
            source: "",
        },
    },
    {
        title: "出どころが知らない場所",
        payload: {
            kind: "unlock",
            action: "grant",
            userId: USER_A,
            roleId: "111111111111111111",
            source: "どこか",
        },
    },
];

for (const testCase of rejects) {
    const message = put(testCase.payload);
    check(`${testCase.title}……断る`, message !== "", message || "受け付けてしまった");
}

const resultRejects = [
    { title: "知らない結果", payload: { status: "maybe", message: "たぶん" } },
    { title: "結果が無い", payload: { message: "理由だけ" } },
    { title: "失敗なのに理由が無い", payload: { status: "failed", message: "" } },
];

for (const testCase of resultRejects) {
    const message = finish(1, testCase.payload);
    check(`${testCase.title}……断る`, typeof message === "string", String(message));
}

check("成功のときは、理由が無くても通る", toResult({ status: "done" }).error === undefined);

// --- 9. 入力のゆれ ---------------------------------------------------------

check("メンションの形でも受け取れる", parseUserId(`<@${USER_A}>`) === USER_A);
check("びっくりマークつきのメンションも受け取れる", parseUserId(`<@!${USER_A}>`) === USER_A);
check("前後の空白は落とす", parseUserId(` ${USER_A} `) === USER_A);
check("名前は受け取らない", parseUserId("たろう") === "");
check("空は受け取らない", parseUserId("") === "");

if (failed === 0) {
    console.log("依頼の受け取りと、書き戻しと、片付けは、期待どおりです。");
} else {
    console.log(`${failed} 件が期待と違います。`);
    process.exitCode = 1;
}
