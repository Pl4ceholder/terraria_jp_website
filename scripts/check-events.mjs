// ==========================================================================
// check-events.mjs — 「これからのイベント」の選び方を、手元で確かめる
//
// 確かめるのは 4 つ。
//   1. これから始まるイベントは出る
//   2. 長く続くイベントは、開催中なら始まってから時間が経っていても出る
//      （10/26〜10/29 のようなイベントが、10/27 に消えてしまわないこと）
//   3. 終わったイベントは出ない
//   4. 終わりが無いイベントは、始まってからしばらく経つと出ない
//
// 材料は、本番で実際に立てたイベントと同じ時刻にしてある。選び方そのものは
// worker/events.js から読むので、本番と食い違うことはない。
//
// 使い方: npm run check:events
// ==========================================================================

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { EVENT_LIST_SQL } from "../worker/events.js";

/** 猶予の時間は index.js と同じ 12 時間。上限は 4 件しか入れないので結果に効かない */
const GRACE_HOURS = 12;
const LIMIT = 100;

const schema = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

const db = new DatabaseSync(":memory:");
db.exec(schema);

// 本番のイベントをそのまま持ってくる
const insert = db.prepare(
    `INSERT INTO events
         (id, guild_id, name, description, location, cover_url, url,
          user_count, start_at, end_at, synced_at)
     VALUES (?1, 'guild', ?2, '', '', '', '', 0, ?3, ?4, ?3)`,
);

const EVENTS = [
    // 10/26 に始まって 10/29 に終わる、長く続くイベント
    ["long", "長期のイベント", "2026-10-26T12:00:00.000Z", "2026-10-29T14:00:00.000Z"],
    // 終わりを決めずに立てたイベント
    ["noEnd", "終わりの無いイベント", "2026-10-19T12:00:00.000Z", null],
    // もう終わったイベント
    ["ended", "終わったイベント", "2026-10-19T05:00:00.000Z", "2026-10-19T07:00:00.000Z"],
    // これから始まる普通のイベント
    ["future", "これからのイベント", "2026-10-20T12:00:00.000Z", "2026-10-20T15:00:00.000Z"],
];

for (const [id, name, startAt, endAt] of EVENTS) {
    insert.run(id, name, startAt, endAt);
}

const select = db.prepare(EVENT_LIST_SQL);

/** その時刻に、どのイベントが出るか（始まる順） */
const showAt = (nowIso) => {
    const now = Date.parse(nowIso);
    const graceIso = new Date(now - GRACE_HOURS * 60 * 60 * 1000).toISOString();

    return select.all(nowIso, graceIso, LIMIT).map((row) => row.id);
};

const CASES = [
    {
        title: "イベント前日……終わったものは出ない",
        now: "2026-10-19T11:00:00.000Z",
        expect: ["noEnd", "future", "long"],
    },
    {
        title: "長期イベントの開催中（始まって 24 時間後）……まだ出る",
        now: "2026-10-27T12:00:00.000Z",
        expect: ["long"],
    },
    {
        title: "長期イベントが終わった直後……出ない",
        now: "2026-10-29T15:00:00.000Z",
        expect: [],
    },
    {
        title: "終わりの無いイベントも、始まって 11 時間なら出る",
        now: "2026-10-19T23:00:00.000Z",
        expect: ["noEnd", "future", "long"],
    },
    {
        title: "終わりの無いイベントは、始まって 13 時間で出さない",
        now: "2026-10-20T01:00:00.000Z",
        expect: ["future", "long"],
    },
    {
        title: "猶予の境目（始まってちょうど 12 時間）までは出す",
        now: "2026-10-20T00:00:00.000Z",
        expect: ["noEnd", "future", "long"],
    },
];

let failed = 0;

for (const testCase of CASES) {
    const got = showAt(testCase.now);
    const ok = JSON.stringify(got) === JSON.stringify(testCase.expect);

    if (ok) {
        console.log(`  OK   ${testCase.title}`);
    } else {
        failed += 1;
        console.log(`  ダメ  ${testCase.title}`);
        console.log(`        出したもの: ${JSON.stringify(got)}`);
        console.log(`        出したいもの: ${JSON.stringify(testCase.expect)}`);
    }
}

if (failed === 0) {
    console.log(`イベントの選び方は ${CASES.length} 通りとも期待どおりです。`);
} else {
    console.log(`${CASES.length} 通りのうち ${failed} 通りが期待と違います。`);
    process.exitCode = 1;
}
