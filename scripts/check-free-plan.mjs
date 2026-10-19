// ==========================================================================
// check-free-plan.mjs — 料金が発生する仕組みが混ざっていないか確かめる
//
// 使い方:
//     npm run check:free
//
// wrangler.jsonc に「使った分だけ請求が来るサービス」が書かれていたら失敗する。
// 「無料枠だけで動かす」という決まりを、人の記憶ではなく道具で守るために置いてある。
//
// 失敗したときは、その設定を消して、無料枠の範囲（Workers と D1）で同じことが
// できないか考える。どうしても要るときは、運営で相談してから入れる。
// ==========================================================================

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(root, "wrangler.jsonc");

/**
 * 請求が発生しうる設定。
 * key は wrangler.jsonc に書く名前、label は人に伝わる名前。
 */
const PAID_SERVICES = [
    {
        key: "r2_buckets",
        label: "R2（画像などの置き場所）",
        note: "使った分だけ請求が来る。画像は D1（images テーブル）に入れる。",
    },
    {
        key: "kv_namespaces",
        label: "Workers KV",
        note: "無料枠を超えると有料プランでは請求が来る。数えるだけなら D1 で足りる。",
    },
    {
        key: "durable_objects",
        label: "Durable Objects",
        note: "動いていた時間だけ請求が来る。",
    },
    {
        key: "queues",
        label: "Cloudflare Queues",
        note: "やり取りした回数だけ請求が来る。",
    },
    {
        key: "vectorize",
        label: "Vectorize",
        note: "有料プラン専用。",
    },
    {
        key: "hyperdrive",
        label: "Hyperdrive",
        note: "無料枠を超えると有料プランでは請求が来る。",
    },
    {
        key: "browser",
        label: "Browser Rendering",
        note: "使った分だけ請求が来る。",
    },
    {
        key: "ai",
        label: "Workers AI",
        note: "使った分だけ請求が来る。",
    },
    {
        key: "analytics_engine_datasets",
        label: "Analytics Engine",
        note: "書き込んだ分だけ請求が来る。",
    },
    {
        key: "pipelines",
        label: "Pipelines",
        note: "流した分だけ請求が来る。",
    },
    {
        key: "containers",
        label: "Containers",
        note: "有料プラン専用。",
    },
    {
        key: "mtls_certificates",
        label: "mTLS 証明書",
        note: "有料プラン向け。",
    },
    {
        key: "dispatch_namespaces",
        label: "Dispatch Namespaces",
        note: "有料プラン向け。",
    },
    {
        key: "send_email",
        label: "メール送信",
        note: "送った分だけ請求が来る。",
    },
    {
        key: "tail_consumers",
        label: "Tail Workers",
        note: "有料プラン向け。",
    },
    {
        key: "logpush",
        label: "Logpush",
        note: "有料プラン専用。",
    },
    {
        key: "services",
        label: "Service bindings",
        note: "無料枠でも動くが、別の Worker を呼ぶ形は今は要らない。",
    },
];

/**
 * JSONC（コメント付き JSON）を、コメントと末尾のカンマを外して読める形にする。
 * 文字列の中の // や /* を消してしまわないように、1 文字ずつ見ていく。
 */
const toJson = (text) => {
    let out = "";
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const next = text[index + 1];

        if (inLineComment) {
            if (char === "\n") {
                inLineComment = false;
                out += char;
            }

            continue;
        }

        if (inBlockComment) {
            if (char === "*" && next === "/") {
                inBlockComment = false;
                index += 1;
            }

            continue;
        }

        if (inString) {
            out += char;

            if (char === "\\") {
                out += next ?? "";
                index += 1;
            } else if (char === '"') {
                inString = false;
            }

            continue;
        }

        if (char === '"') {
            inString = true;
            out += char;
            continue;
        }

        if (char === "/" && next === "/") {
            inLineComment = true;
            index += 1;
            continue;
        }

        if (char === "/" && next === "*") {
            inBlockComment = true;
            index += 1;
            continue;
        }

        out += char;
    }

    return out.replace(/,(\s*[}\]])/g, "$1");
};

const readConfig = () => {
    let config;

    try {
        config = JSON.parse(toJson(readFileSync(configPath, "utf8")));
    } catch (error) {
        console.error("wrangler.jsonc を読めませんでした:", error.message);
        process.exit(1);
    }

    // 読み違いに気づけるように、必ずあるはずの項目を確かめる
    for (const key of ["name", "main", "assets", "d1_databases"]) {
        if (!(key in config)) {
            console.error(
                `wrangler.jsonc に ${key} がありません（読み取りに失敗したかもしれません）。`,
            );
            process.exit(1);
        }
    }

    return config;
};

const config = readConfig();
const found = PAID_SERVICES.filter((service) => service.key in config);

if (found.length > 0) {
    console.error("料金が発生しうる設定が入っています。\n");

    for (const service of found) {
        console.error(`  ・${service.label}（${service.key}）`);
        console.error(`    ${service.note}`);
    }

    console.error("\n無料枠の範囲（Workers と D1）でできないか考えてから、入れ直してください。");
    process.exit(1);
}

console.log("無料枠だけで動く設定です（料金が発生する仕組みは入っていません）。");
console.log(`  ・Worker: ${config.name}（Workers Free の範囲で動く）`);
console.log(`  ・保存場所: D1（${config.d1_databases[0].database_name}）`);
console.log("  ・アカウントは Workers Free のままにする（有料プランに変えると請求が始まります）");
