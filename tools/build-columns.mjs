// ==========================================================================
// build-columns.mjs — コラム（columns/*.md）から _site/ を組み立てる
//
// 使い方: npm run build
//
// 1. columns/ の Markdown を HTML にする（1 記事 = 1 ファイル）
// 2. columns.html（記事の一覧）を作る
// 3. サイト全体を _site/ にコピーする（dev/ は開発用なので公開しない）
//
// GitHub Actions（.github/workflows/pages.yml）も同じコマンドを実行し、
// 出来上がった _site/ をそのまま GitHub Pages に公開する。
// _site/ は生成物なのでコミットしない（.gitignore 済み）。
//
// 記事の書き方は columns/README.md を参照。
// ==========================================================================

import {
    cpSync,
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { marked } from "marked";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COLUMNS_DIR = join(ROOT, "columns");
const OUTPUT_DIR = join(ROOT, "_site");

const SITE_NAME = "Terraria JP";
const COLUMNS_TITLE = "コラム";

/** そのまま _site/ へ持っていくもの（コラム以外のページと素材） */
const STATIC_ENTRIES = ["index.html", "news.html", "server.html", "assets"];

/** 記事で使う画像の置き場所（columns/img/ があればそのまま公開する） */
const COLUMN_ASSETS = "img";

/** 記事として扱わないファイル（説明書きとひな形） */
const IGNORED_FILES = new Set(["README.md"]);

/** 生の HTML は文字として出す。投稿された Markdown を安全に扱うため */
const escapeHtml = (text) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 生成した HTML を、周りのインデントに合わせる */
const indent = (html, spaces) =>
    html
        .split("\n")
        .map((line) => (line.trim() === "" ? "" : " ".repeat(spaces) + line))
        .join("\n");

/** 生の HTML の扱い。HTML コメントだけは目印として残し、それ以外は文字として出す */
const renderHtml = (token) => {
    const text = token.text.trimEnd();
    const output = text.trimStart().startsWith("<!--") ? text : escapeHtml(text);

    // ブロックの HTML は、前後の段落と地続きにならないように行を分ける
    return token.block ? `${output}\n` : output;
};

// Markdown の読み込み方 ----------------------------------------------------
// 生の HTML は文字として出す（コメントだけは目印として使えるよう残す）。
// 改行をそのまま <br> にするのは、Markdown に慣れていない人向け。
marked.use({
    gfm: true,
    breaks: true,
    renderer: { html: renderHtml },
});

/**
 * 先頭の --- で挟んだ部分（front matter）と本文に分ける。
 * 「title: 値」の 1 行 1 項目だけを読む。値の中の「:」はそのまま使える。
 */
const splitFrontMatter = (source) => {
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) {
        return { meta: {}, body: source };
    }

    const meta = {};
    for (const line of match[1].split(/\r?\n/)) {
        const separator = line.indexOf(":");
        if (separator === -1) continue;

        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        if (key) {
            meta[key] = value;
        }
    }

    return { meta, body: source.slice(match[0].length) };
};

const readField = (file, meta, key) => {
    const value = meta[key];
    if (!value) {
        throw new Error(
            `${file}: 「${key}」がありません。先頭の --- で挟んだ部分に「${key}: 値」の形で書いてください（columns/_template.md を参照）。`,
        );
    }
    return value;
};

const readDate = (file, meta) => {
    const value = readField(file, meta, "date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
        throw new Error(
            `${file}: 「date」は 2026-10-19 の形で書いてください（今は「${value}」）。`,
        );
    }
    return value;
};

const isArticleFile = (name) =>
    name.endsWith(".md") && !name.startsWith("_") && !IGNORED_FILES.has(name);

/**
 * columns/*.md を 1 件ずつ読み、記事のデータにする。
 * ファイル名（拡張子を除いたもの）がそのまま URL になる。
 */
const readColumns = () => {
    const columns = readdirSync(COLUMNS_DIR)
        .filter(isArticleFile)
        .sort()
        .map((file) => {
            const source = readFileSync(join(COLUMNS_DIR, file), "utf8");
            const { meta, body } = splitFrontMatter(source);
            const date = readDate(file, meta);

            return {
                slug: file.replace(/\.md$/, ""),
                title: readField(file, meta, "title"),
                date,
                dateText: date.replaceAll("-", "."),
                author: meta.author ?? "",
                tags: (meta.tags ?? "")
                    .split(/[,、]/)
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                body: body.trim(),
            };
        });

    // 新しい記事を上にする。同じ日付のときはファイル名順。
    return columns.sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
};

/** meta description 用に本文の冒頭を 1 行の文にする */
const buildExcerpt = (markdown) => {
    const text = markdown
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .split("\n")
        .map((line) => line.replace(/^(?:[-*+>#]+|\d+\.)\s*/, "").trim())
        .filter(Boolean)
        .join(" ")
        .replace(/[`~]/g, "")
        .trim();

    return text.length > 110 ? `${text.slice(0, 110)}…` : text;
};

// ページの組み立て ----------------------------------------------------------
// 手書きのページ（news.html など）と同じ形にする。
// 共通ヘッダ・フッターは Web Component なので、ここでは読み込むだけ。
// base は、そのページからサイトのルートまでの相対パス（下の階層のページでは "../"）。

const layout = ({ title, description, base, body }) => `<!doctype html>
<html lang="ja">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${escapeHtml(title)}</title>
        <meta name="description" content="${escapeHtml(description)}" />
        <link rel="stylesheet" href="${base}assets/css/style.css" />
    </head>

    <body>
        <!-- 共通ヘッダ（assets/js/components/site-header.js） -->
        <x-site-header></x-site-header>

        <main class="l-main">
${body}
        </main>

        <!-- 共通フッター（assets/js/components/site-footer.js） -->
        <x-site-footer></x-site-footer>

        <script src="${base}assets/js/components/site-header.js" defer></script>
        <script src="${base}assets/js/components/site-footer.js" defer></script>
    </body>
</html>
`;

const renderArticle = (column) => {
    const html = indent(marked.parse(column.body), 24);
    const meta = [
        column.author ? escapeHtml(column.author) : "",
        column.tags.length > 0 ? `タグ: ${column.tags.map(escapeHtml).join(", ")}` : "",
    ]
        .filter(Boolean)
        .join(" ・ ");

    const body = `            <header class="c-page-header">
                <div class="l-container l-container--narrow">
                    <p class="c-page-header__lead">
                        <time datetime="${column.date}">${column.dateText}</time>
                    </p>
                    <h1 class="c-page-header__title">${escapeHtml(column.title)}</h1>${
                        meta
                            ? `\n                    <p class="c-page-header__text">${meta}</p>`
                            : ""
                    }
                </div>
            </header>

            <div class="l-container l-container--narrow">
                <article class="p-column">
                    <div class="p-column__body">
${html}
                    </div>
                </article>
            </div>`;

    return layout({
        title: `${column.title} | ${COLUMNS_TITLE} | ${SITE_NAME}`,
        description: buildExcerpt(column.body),
        base: "../",
        body,
    });
};

const renderList = (columns) => {
    const items = columns
        .map((column) => {
            const author = column.author
                ? `
                            <span class="p-columns-list__author">${escapeHtml(column.author)}</span>`
                : "";

            return `                    <li class="p-columns-list__item">
                        <a class="p-columns-list__link" href="columns/${column.slug}.html">
                            <time class="p-columns-list__date" datetime="${column.date}">${column.dateText}</time>
                            <span class="p-columns-list__title">${escapeHtml(column.title)}</span>${author}
                        </a>
                    </li>`;
        })
        .join("\n");

    const body = `            <header class="c-page-header">
                <div class="l-container l-container--narrow">
                    <p class="c-page-header__lead">${SITE_NAME} のコラム</p>
                    <h1 class="c-page-header__title">${COLUMNS_TITLE}</h1>
                </div>
            </header>

            <div class="l-container l-container--narrow">
                <ul class="p-columns-list">
${items}
                </ul>
            </div>`;

    return layout({
        title: `${COLUMNS_TITLE} | ${SITE_NAME}`,
        description: `${SITE_NAME} のコラム（Terraria の読み物）の一覧です。`,
        base: "",
        body,
    });
};

// 書き出し ------------------------------------------------------------------
const writeSite = (columns) => {
    rmSync(OUTPUT_DIR, { recursive: true, force: true });
    mkdirSync(OUTPUT_DIR, { recursive: true });

    for (const entry of STATIC_ENTRIES) {
        const from = join(ROOT, entry);
        if (existsSync(from)) {
            cpSync(from, join(OUTPUT_DIR, entry), { recursive: true });
        }
    }

    mkdirSync(join(OUTPUT_DIR, "columns"), { recursive: true });

    const columnAssets = join(COLUMNS_DIR, COLUMN_ASSETS);
    if (existsSync(columnAssets)) {
        cpSync(columnAssets, join(OUTPUT_DIR, "columns", COLUMN_ASSETS), { recursive: true });
    }

    for (const column of columns) {
        writeFileSync(
            join(OUTPUT_DIR, "columns", `${column.slug}.html`),
            renderArticle(column),
            "utf8",
        );
    }

    writeFileSync(join(OUTPUT_DIR, "columns.html"), renderList(columns), "utf8");
};

const main = () => {
    try {
        const columns = readColumns();
        writeSite(columns);
        console.log(`コラム ${columns.length} 件を _site/ に書き出しました。`);
    } catch (error) {
        // 書き方の間違いはスタックトレースではなく、メッセージだけを出す
        console.error(`コラムを書き出せませんでした。\n${error.message}`);
        process.exitCode = 1;
    }
};

main();
