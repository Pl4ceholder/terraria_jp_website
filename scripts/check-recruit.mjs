// ==========================================================================
// check-recruit.mjs — 「いま立っている募集」の選び方を、手元で確かめる
//
// 確かめるのは 4 つ。
//   1. 流れる時刻を過ぎた募集は出ない（bot が止まっていても、古い募集が残らない）
//   2. 書き込みが続いて延びた募集は、立ててから 24 時間を過ぎても出る
//   3. 流れる時刻を過ぎた直後は、まだ出る（猶予の間）
//   4. Discord の設定（何分で流すか）が短い場合は、その通りに消える
//
// 求め方と抽出の条件は、本番と同じ worker/recruitments.js から読む。材料の時刻は、
// 本番で立てた募集と同じ形にしてある。
//
// 使い方: npm run check:recruit
// ==========================================================================

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import {
    deadlineOf,
    RECRUIT_GRACE_MINUTES,
    RECRUIT_HIDDEN_SQL,
    RECRUIT_LIST_SQL,
} from "../worker/recruitments.js";

const LIMIT = 100;

const schema = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

const db = new DatabaseSync(":memory:");
db.exec(schema);

/**
 * 募集を 1 件入れる。
 *
 * 流れる時刻は本番と同じ関数で計算する（`deadline: null` のときは「分からない」状態）。
 */
const insert = db.prepare(
    `INSERT INTO recruitments
         (id, guild_id, channel_id, message_id, mode, platform, vc, connection, message,
          author_id, author_name, author_icon, started_at, last_activity_at,
          message_count, archive_minutes, deadline_at, synced_at)
     VALUES (?1, 'guild', '', '', 'バニラマルチ', 'PC', 'バニラVC1', 'なし', '', '', '', '',
             ?2, ?3, ?4, ?5, ?6, ?7)`,
);

const rows = [
    // 書き込みが続いて、立ててから 24 時間以上たっている募集
    ["bumped", "2026-10-18T12:00:00Z", "2026-10-19T10:00:00Z", 5, 1440],
    // たった今立てた募集
    ["fresh", "2026-10-19T11:30:00Z", "2026-10-19T11:30:00Z", 0, 1440],
    // とっくに流れる時刻を過ぎた募集
    ["old", "2026-10-17T09:00:00Z", "2026-10-17T09:00:00Z", 3, 1440],
    // 流れる時刻を過ぎた直後（猶予の中）
    ["justOver", "2026-10-18T11:00:00Z", "2026-10-18T11:30:00Z", 8, 1440],
    // Discord 側が「1 時間で流す」設定にしている募集
    ["shortArchive", "2026-10-19T11:00:00Z", "2026-10-19T11:00:00Z", 1, 60],
    // 流れる時刻が分からない募集（古い行。判断できないので出す）
    ["noDeadline", "2026-10-16T09:00:00Z", null, 0, 0],
];

for (const [id, startedAt, lastActivityAt, messageCount, archiveMinutes] of rows) {
    const deadline = lastActivityAt
        ? deadlineOf({ startedAt, lastActivityAt, archiveMinutes })
        : null;

    insert.run(id, startedAt, lastActivityAt, messageCount, archiveMinutes, deadline, startedAt);
}

const select = db.prepare(RECRUIT_LIST_SQL);
const countHidden = db.prepare(RECRUIT_HIDDEN_SQL);

/** その時刻に、どの募集が出るか（新しい順）と、出していない数 */
const showAt = (nowIso) => {
    const graceIso = new Date(Date.parse(nowIso) - RECRUIT_GRACE_MINUTES * 60 * 1000).toISOString();

    return {
        ids: select.all(graceIso, LIMIT).map((row) => row.id),
        hidden: countHidden.get(graceIso).hidden,
    };
};

const CASES = [
    {
        title: "いま……古い募集だけ出ない",
        now: "2026-10-19T12:00:00Z",
        ids: ["fresh", "shortArchive", "bumped", "justOver", "noDeadline"],
        hidden: 1,
    },
    {
        title: "4 時間後……流れる時刻を過ぎたものが順に出なくなる",
        now: "2026-10-19T16:00:00Z",
        ids: ["fresh", "bumped", "noDeadline"],
        hidden: 3,
    },
    {
        title: "bot が止まって 2 日後……古い募集は出ない（分からないものだけ残る）",
        now: "2026-10-21T12:00:00Z",
        ids: ["noDeadline"],
        hidden: 5,
    },
];

let failed = 0;

for (const testCase of CASES) {
    const got = showAt(testCase.now);
    const ok =
        JSON.stringify(got.ids) === JSON.stringify(testCase.ids) && got.hidden === testCase.hidden;

    if (ok) {
        console.log(`  OK   ${testCase.title}`);
    } else {
        failed += 1;
        console.log(`  ダメ  ${testCase.title}`);
        console.log(
            `        出したもの: ${JSON.stringify(got.ids)} / 出していない数: ${got.hidden}`,
        );
        console.log(
            `        出したいもの: ${JSON.stringify(testCase.ids)} / 出していない数: ${testCase.hidden}`,
        );
    }
}

// 流れる時刻そのものが、書き込みで延びることも確かめる
const bumpedDeadline = deadlineOf({
    startedAt: "2026-10-18T12:00:00Z",
    lastActivityAt: "2026-10-19T10:00:00Z",
    archiveMinutes: 1440,
});

if (bumpedDeadline === "2026-10-20T10:00:00.000Z") {
    console.log("  OK   流れる時刻は、最後の書き込みから数える");
} else {
    failed += 1;
    console.log(`  ダメ  流れる時刻は、最後の書き込みから数える（${bumpedDeadline}）`);
}

if (failed === 0) {
    console.log(`募集の選び方は ${CASES.length + 1} 通りとも期待どおりです。`);
} else {
    console.log(`${CASES.length + 1} 通りのうち ${failed} 通りが期待と違います。`);
    process.exitCode = 1;
}
