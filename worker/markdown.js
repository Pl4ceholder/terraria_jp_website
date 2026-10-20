// ==========================================================================
// markdown.js — 投稿された文章（Markdown）を HTML にする
//
// コラムは誰でも投稿できるので、本文は「文字」として扱う。
// 生の HTML はそのままでは通さず、文字として表示する（HTML コメントだけは
// 目印として使えるように残す）。
//
// サイト内のどこでも同じ結果になるよう、レンダリングはここ 1 か所に置く。
// ==========================================================================

import { marked } from "marked";

/** HTML に埋め込む前に、危険な文字を無害な文字にする */
export const escapeHtml = (text) =>
    String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

/**
 * 生の HTML の扱い。HTML コメントだけは目印として残し、それ以外は文字として出す。
 * ブロックの HTML は、前後の段落と地続きにならないように行を分ける。
 */
const renderHtml = (token) => {
    const text = token.text.trimEnd();
    const output = text.trimStart().startsWith("<!--") ? text : escapeHtml(text);

    return token.block ? `${output}\n` : output;
};

// 改行をそのまま改行として扱うのは、Markdown に慣れていない人向け
marked.use({
    gfm: true,
    breaks: true,
    renderer: { html: renderHtml },
});

/** Markdown を HTML にする */
export const renderMarkdown = (markdown) => marked.parse(String(markdown));

/** 検索結果などに出す、本文の冒頭を 1 行にしたもの */
export const buildExcerpt = (markdown, limit = 110) => {
    const text = String(markdown)
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .split("\n")
        .map((line) =>
            line
                .replace(/^(?:[-*+>#]+|\d+\.)\s*/, "")
                .replace(/\|/g, " ")
                .trim(),
        )
        .filter(Boolean)
        .join(" ")
        .replace(/[`~*]/g, "")
        .trim();

    return text.length > limit ? `${text.slice(0, limit)}…` : text;
};
