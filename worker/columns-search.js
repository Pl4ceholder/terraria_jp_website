// ==========================================================================
// columns-search.js — コラムの検索と、タグの絞り込み
//
// 一覧の絞り込みは SQL で行う。記事が増えても、読む行を増やさずに済む。
// ここには「URL の ?q= / ?tag= をどう整えるか」「どんな WHERE にするか」
// 「タグの件数をどう数えるか」だけを置き、HTML は html.js に任せる。
// ==========================================================================

import { trimTo } from "./values.js";

/** 検索語とタグの長さ。長すぎる URL で重くならないように切る */
export const SEARCH_LIMIT = 100;
export const TAG_LIMIT = 100;

/** タグはカンマ（と読点）で区切る。前後の空白は落とす */
export const splitTags = (value) =>
    String(value ?? "")
        .split(/[,、]/)
        .map((tag) => tag.trim())
        .filter(Boolean);

/** URL の ?q= と ?tag= を、決めた長さに整える */
export const normalizeColumnQuery = (searchParams) => ({
    q: trimTo(searchParams.get("q"), SEARCH_LIMIT),
    tag: trimTo(searchParams.get("tag"), TAG_LIMIT),
});

/**
 * 公開中のコラムから探すための WHERE 句と、渡す値。
 *
 * q は題名・本文・書いた人・タグのどこかに含まれていればよい。
 * tag は「,タグ,」の形で囲んで、部分的に一致しないようにする。
 * 昔のデータは「ボス, 装備」のようにカンマのあとに空白が入っているので、
 * 比べる前に「, 」を「,」に直す。
 */
export const buildColumnFilter = ({ q = "", tag = "" } = {}) => {
    const clauses = ["status = 'published'"];
    const bindings = [];

    if (tag) {
        clauses.push("instr(lower(',' || replace(tags, ', ', ',') || ','), lower(?)) > 0");
        bindings.push(`,${tag},`);
    }

    if (q) {
        clauses.push(
            `(instr(lower(title), lower(?)) > 0
              OR instr(lower(body_md), lower(?)) > 0
              OR instr(lower(author), lower(?)) > 0
              OR instr(lower(tags), lower(?)) > 0)`,
        );
        bindings.push(q, q, q, q);
    }

    return { where: clauses.join(" AND "), bindings };
};

/**
 * 公開中のコラムから、タグと件数を集める。
 * 件数の多い順。同じ件数なら名前順にして、並びが毎回変わらないようにする。
 */
export const collectTags = (rows) => {
    const counts = new Map();

    for (const row of rows) {
        for (const tag of splitTags(row.tags)) {
            counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
    }

    return [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ja"));
};
