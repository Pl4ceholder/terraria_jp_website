// ==========================================================================
// check-achievements.mjs — 実績の取り込み方と、自分の実績の引き方を手元で確かめる
//
// 確かめるのは 2 つ。
//   1. bot から届いた内容を、保存できる形に整えられるか（worker/achievements.js の toAchievementRows）
//   2. 保存した形から、自分の実績を正しく引けるか（同じファイルの ACHIEVEMENT_LIST_SQL）
//
// 本番と同じ順番（整える → 保存する → 引く）で流して確かめる。SQL と整え方は本番と
// 同じものを使うので、ここが通れば本番でも同じ結果になる。
//
// 使い方: npm run check:achievements
// ==========================================================================

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import {
    ACHIEVEMENT_LIST_SQL,
    ACHIEVEMENT_MAX,
    ACHIEVEMENT_MEMBERS_MAX,
    MEMBER_NAME_MAX,
    toAchievementRows,
} from "../worker/achievements.js";

const SYNCED_AT = "2026-10-19T12:00:00Z";

const A1 = "1543500048245981275";
const A2 = "1543500112456585267";
const A3 = "1543500149798473828";

const db = new DatabaseSync(":memory:");
db.exec(readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8"));

const insertMaster = db.prepare(
    `INSERT INTO achievements (id, name, position, synced_at) VALUES (?1, ?2, ?3, ?4)`,
);
const insertMember = db.prepare(
    `INSERT INTO member_achievements (user_id, name, unlocked, title, synced_at) VALUES (?1, ?2, ?3, ?4, ?5)`,
);

/** 届いた内容を、本番と同じ手順で入れる。断られたらメッセージを返す */
const load = (payload) => {
    const rows = toAchievementRows(payload, SYNCED_AT);
    if (rows.error) return rows.error;

    db.exec(`DELETE FROM achievements`);
    db.exec(`DELETE FROM member_achievements`);

    for (const row of rows.data.master) {
        insertMaster.run(row.id, row.name, row.position, row.syncedAt);
    }
    for (const row of rows.data.members) {
        insertMember.run(row.userId, row.name, row.unlocked, row.title, row.syncedAt);
    }

    return "";
};

/** その人から見た実績の一覧。「ID:解放:称号」の形にして比べやすくする */
const listFor = (userId) =>
    db
        .prepare(ACHIEVEMENT_LIST_SQL)
        .all(userId)
        .map((row) => `${row.id}:${row.unlocked}${row.worn ? ":称号" : ""}`)
        .join(" ");

/** 保存されている人数 */
const memberCount = () =>
    db.prepare(`SELECT COUNT(*) AS count FROM member_achievements`).get().count;

/** 保存されている称号（そのまま確かめたいとき用） */
const rawTitle = (userId) =>
    db.prepare(`SELECT title FROM member_achievements WHERE user_id = ?1`).get(userId)?.title ??
    "(なし)";

/** 保存されている表示名（そのまま確かめたいとき用） */
const rawName = (userId) =>
    db.prepare(`SELECT name FROM member_achievements WHERE user_id = ?1`).get(userId)?.name ??
    "(なし)";

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

// --- 1. 取り込みと引き方 ---------------------------------------------------

// わざと番号の順ではなく、Discord 側の定義の順で並べてある（並び順を持ち回れているか見る）
const payload = {
    guildId: "999000111222333444",
    achievements: [
        { id: A3, name: "マスター" },
        { id: A1, name: "ビギナー" },
        { id: A2, name: "ビルダー" },
    ],
    members: [
        // 順番はばらばらで、称号も付いている
        { userId: "1", name: "たろう", unlocked: [A2, A1], title: A2 },
        // 1 つも持っていない人（名前がまだ届いていない）
        { userId: "2", name: "", unlocked: [], title: "" },
        // 実績の一覧に無い ID（消えたロール）と、無いものを称号にしている人
        {
            userId: "3",
            name: "じろう",
            unlocked: [A1, "9999999999999999999"],
            title: "9999999999999999999",
        },
        // 同じ人がもう一度出てきた（あとのものは入れない）
        { userId: "1", name: "たろう（別名）", unlocked: [A1, A2, A3], title: A3 },
    ],
};

const accepted = load(payload);
check("届いた内容を取り込める", accepted === "", accepted);
check(
    "自分から見た実績が、Discord の並び順で出る",
    listFor("1") === `${A3}:0 ${A1}:1 ${A2}:1:称号`,
    listFor("1"),
);
check(
    "1 つも持っていない人は、どれも解放されていない",
    listFor("2") === `${A3}:0 ${A1}:0 ${A2}:0`,
    listFor("2"),
);
check("実績の一覧に無い ID は入らない", listFor("3") === `${A3}:0 ${A1}:1 ${A2}:0`, listFor("3"));
check("同じ人が何度出てきても 1 行", memberCount() === 3, `人数: ${memberCount()}`);
check(
    "称号は、解放済みのものだけ残る",
    rawTitle("1") === A2 && rawTitle("3") === "",
    `1: ${rawTitle("1")} ／ 3: ${rawTitle("3")}`,
);
check(
    "表示名も保存する（管理画面で使う）",
    rawName("1") === "たろう" && rawName("3") === "じろう",
    `1: ${rawName("1")} ／ 3: ${rawName("3")}`,
);
check("名前が無くても保存できる", rawName("2") === "", rawName("2"));

// 長すぎる名前は切って保存する（一覧が崩れないように）
const longName = "あ".repeat(MEMBER_NAME_MAX + 10);
load({
    guildId: "999000111222333444",
    achievements: [{ id: A1, name: "ビギナー" }],
    members: [{ userId: "5", name: longName, unlocked: [A1], title: "" }],
});
check(
    "長すぎる名前は切って保存する",
    rawName("5").length === MEMBER_NAME_MAX,
    `長さ: ${rawName("5").length}`,
);

// --- 2. 区切りの取り違え ---------------------------------------------------

// 「11」と「111」のように、片方がもう片方を含む ID でも取り違えないこと
const shortPayload = {
    guildId: "999000111222333444",
    achievements: [
        { id: "111", name: "長いほう" },
        { id: "11", name: "短いほう" },
    ],
    members: [{ userId: "9", unlocked: ["111"], title: "111" }],
};

load(shortPayload);
check(
    "片方をもう片方と取り違えない（11 と 111）",
    listFor("9") === "111:1:称号 11:0",
    listFor("9"),
);

// --- 3. 断るべきもの -------------------------------------------------------

const base = {
    guildId: "999000111222333444",
    achievements: [{ id: A1, name: "ビギナー" }],
    members: [],
};
const manyMembers = Array.from({ length: ACHIEVEMENT_MEMBERS_MAX + 1 }, (_, index) => ({
    userId: String(index + 1),
    unlocked: [A1],
    title: "",
}));
const manyAchievements = Array.from({ length: ACHIEVEMENT_MAX + 1 }, (_, index) => ({
    id: String(1543500000000000000 + index),
    name: `実績 ${index}`,
}));

const rejects = [
    { title: "実績の一覧が無い", payload: { ...base, achievements: undefined } },
    { title: "誰が何を解放したかが無い", payload: { ...base, members: undefined } },
    { title: "Discord のサーバー ID が無い", payload: { ...base, guildId: "" } },
    {
        title: `実績が ${ACHIEVEMENT_MAX} 件を超えている`,
        payload: { ...base, achievements: manyAchievements },
    },
    {
        title: `人が ${ACHIEVEMENT_MEMBERS_MAX} 人を超えている`,
        payload: { ...base, members: manyMembers },
    },
];

for (const testCase of rejects) {
    const message = load(testCase.payload);
    check(`${testCase.title}……断る`, message !== "", message || "受け付けてしまった");
}

// 上限ちょうどは通す
check(
    `${ACHIEVEMENT_MAX} 件・${ACHIEVEMENT_MEMBERS_MAX} 人は通す`,
    load({
        ...base,
        achievements: manyAchievements.slice(0, ACHIEVEMENT_MAX),
        members: manyMembers.slice(0, ACHIEVEMENT_MEMBERS_MAX),
    }) === "",
);

// 実績が 0 件でも、引ける（Discord 側から実績が消えたとき）
check(
    "実績が 0 件でも引ける",
    load({ ...base, achievements: [], members: [] }) === "" && listFor("1") === "",
);

if (failed === 0) {
    console.log("実績の取り込みと引き方は、期待どおりです。");
} else {
    console.log(`${failed} 件が期待と違います。`);
    process.exitCode = 1;
}
