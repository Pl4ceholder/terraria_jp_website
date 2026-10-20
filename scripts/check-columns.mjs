// ==========================================================================
// check-columns.mjs — コラムの検索とタグの絞り込みを、手元で確かめる
//
// 確かめるのは、次のとおり。
//   1. 検索語が題名・本文・書いた人・タグのどこかに当たる
//   2. タグは「, タグ,」の形で比べる（「装備」で「装備品」に当たらない）
//   3. 公開していないコラムは、検索でもタグでも出ない
//   4. 検索語の % や _ は、ワイルドカードではなく文字として扱う
//   5. タグの件数は公開中の全件から数え、絞り込み中でもほかのタグを選べる
//   6. 検索語とタグはページに戻り、HTML として危険な文字は無害にする
//
// 一覧の組み立ては本番と同じ worker/columns-api.js と worker/html.js を通す。
// 使い方: npm run check:columns
// ==========================================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { handleColumnList } from "../worker/columns-api.js";
import { normalizeColumnQuery } from "../worker/columns-search.js";

const schema = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const db = new DatabaseSync(":memory:");
db.exec(schema);

const insert = db.prepare(
    `INSERT INTO columns
         (id, slug, title, body_md, body_html, author, tags, status,
          created_at, published_at, ip_hash)
     VALUES (?1, ?1, ?2, ?3, '', ?4, ?5, ?6, ?7, ?7, '')`,
);

const rows = [
    [
        "boss",
        "ボス戦の前に揃えたい装備",
        "足場を用意しておくと安心です。",
        "たけのこ",
        "ボス, 装備",
        "published",
    ],
    ["build", "建築をはじめる前に", "家の広さを決めましょう。", "あお", "建築,装備", "published"],
    ["gearbrand", "装備品をそろえる", "装備品についての記事です。", "あお", "装備品", "published"],
    ["pending", "秘密の下書き", "足場の記事です。", "たけのこ", "ボス", "pending"],
];

for (const [id, title, body, author, tags, status] of rows) {
    insert.run(id, title, body, author, tags, status, "2026-10-01T00:00:00Z");
}

/** handleColumnList が使う D1 の形だけを、その場の SQLite で用意する */
const env = {
    DB: {
        prepare(sql) {
            const statement = db.prepare(sql);
            const bound = (args) => ({
                all: async () => ({ results: statement.all(...args) }),
                first: async () => statement.get(...args) ?? null,
            });

            return {
                bind: (...args) => bound(args),
                all: async () => ({ results: statement.all() }),
                first: async () => statement.get() ?? null,
            };
        },
    },
};

const pageAt = async (search = "") => {
    const response = await handleColumnList(env, `https://example.com/columns${search}`);
    assert.equal(response.status, 200);
    return response.text();
};

let failed = 0;

const check = async (title, fn) => {
    try {
        await fn();
        console.log(`  OK   ${title}`);
    } catch (error) {
        failed += 1;
        console.log(`  ダメ  ${title}`);
        console.log(`        ${error.message}`);
    }
};

await check("条件なしでは、公開中の 3 件だけを出す", async () => {
    const html = await pageAt();
    assert.match(html, /ボス戦の前に揃えたい装備/);
    assert.match(html, /建築をはじめる前に/);
    assert.match(html, /装備品をそろえる/);
    assert.doesNotMatch(html, /秘密の下書き/);
    assert.match(html, /すべてのコラム 3 件/);
});

await check("検索語は、本文・書いた人にも当たる", async () => {
    const byBody = await pageAt("?q=%E8%B6%B3%E5%A0%B4");
    assert.match(byBody, /ボス戦の前に揃えたい装備/);
    assert.doesNotMatch(byBody, /建築をはじめる前に/);
    assert.doesNotMatch(byBody, /装備品をそろえる/);

    const byAuthor = await pageAt("?q=%E3%81%9F%E3%81%91%E3%81%AE%E3%81%93");
    assert.match(byAuthor, /ボス戦の前に揃えたい装備/);
    assert.doesNotMatch(byAuthor, /秘密の下書き/);
});

await check("タグは、カンマのあとに空白があっても当たる", async () => {
    const html = await pageAt(`?tag=${encodeURIComponent("装備")}`);
    assert.match(html, /ボス戦の前に揃えたい装備/);
    assert.match(html, /建築をはじめる前に/);
    assert.doesNotMatch(html, /装備品をそろえる/);
    assert.match(html, /タグ「装備」 のコラム 2 件/);
});

await check("タグは、部分的に一致しない（「装備」で「装備品」に当たらない）", async () => {
    const html = await pageAt(`?tag=${encodeURIComponent("装備品")}`);
    assert.doesNotMatch(html, /ボス戦の前に揃えたい装備/);
    assert.match(html, /装備品をそろえる/);
    assert.match(html, /タグ「装備品」 のコラム 1 件/);
});

await check("公開していないコラムは、検索でもタグでも出ない", async () => {
    const html = await pageAt("?q=%E7%A7%98%E5%AF%86");
    assert.doesNotMatch(html, /秘密の下書き/);
    assert.match(html, /条件に合うコラムはありません/);
});

await check("検索語の % と _ は、文字として扱う", async () => {
    assert.match(await pageAt("?q=%25"), /条件に合うコラムはありません/);
    assert.match(await pageAt("?q=_"), /条件に合うコラムはありません/);
});

await check("タグの件数は全件から数え、絞り込み中もほかのタグを選べる", async () => {
    const html = await pageAt(`?tag=${encodeURIComponent("装備")}`);
    assert.match(html, /#装備 <span class="p-columns-filter__tag-count">2<\/span>/);
    assert.match(html, /#ボス <span class="p-columns-filter__tag-count">1<\/span>/);
    assert.match(html, /#建築 <span class="p-columns-filter__tag-count">1<\/span>/);
    assert.match(html, /#装備品 <span class="p-columns-filter__tag-count">1<\/span>/);
});

await check("検索語とタグは、検索框とタグのリンクに残る", async () => {
    const html = await pageAt(`?q=${encodeURIComponent("足場")}&tag=${encodeURIComponent("ボス")}`);
    assert.match(html, /value="足場"/);
    assert.match(html, /name="tag" value="ボス"/);
    assert.match(html, /aria-current="true">#ボス/);
    assert.match(html, /q=%E8%B6%B3%E5%A0%B4&amp;tag=%E3%83%9C%E3%82%B9/);
});

await check("検索語に HTML を入れても、そのまま実行されない", async () => {
    const payload = "<script>alert(1)</script>";
    const html = await pageAt(`?q=${encodeURIComponent(payload)}`);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

await check("URL の検索語とタグは、前後の空白を落として 100 文字までにする", () => {
    const parsed = normalizeColumnQuery(
        new URL(
            `https://example.com/columns?q=${encodeURIComponent("  hello  ")}&tag=${encodeURIComponent(" ボス ")}`,
        ).searchParams,
    );
    assert.deepEqual(parsed, { q: "hello", tag: "ボス" });

    const long = "あ".repeat(150);
    const capped = normalizeColumnQuery(
        new URL(`https://example.com/columns?q=${encodeURIComponent(long)}`).searchParams,
    );
    assert.equal(capped.q.length, 100);
});

if (failed === 0) {
    console.log("コラムの検索とタグの絞り込みは、すべて期待どおりです。");
} else {
    console.log(`${failed} 通りが期待と違います。`);
    process.exitCode = 1;
}
