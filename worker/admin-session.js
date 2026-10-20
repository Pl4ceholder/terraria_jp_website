// ==========================================================================
// admin-session.js — 運営（合言葉）の出入りと、「入っている証」の確かめ方
//
// 合言葉そのものは保存しない。合言葉を鍵にして作った印（HMAC）と期限だけを
// クッキーに入れ、毎回ここで見比べる。ログインの失敗は IP のハッシュごとに
// 数え、続けて間違えたらしばらく断る。
//
// コラムの承認・活動の取り下げ・実績の付与は、すべてこの isAdmin を通る。
// ==========================================================================

import { forbidden, jsonResponse, methodNotAllowed, readJson, isSameOrigin } from "./http.js";
import { isSame, readCookie, signWithKey } from "./signing.js";

const ADMIN_COOKIE = "admin_session";
const SESSION_HOURS = 12;
const LOGIN_FAILURES = 5;
const LOGIN_WINDOW_MINUTES = 10;

/** いたずら対策。IP そのものは残さず、毎回同じ値になる形にして保存する */
export const hashIp = async (request, env) => {
    const ip = request.headers.get("cf-connecting-ip") ?? "";
    const salt = env.IP_SALT ?? "terraria-jp";
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip}`));

    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

/** 証が本物かを見分けるための印。合言葉を鍵にして作る */
const sign = (env, message) => signWithKey(`admin:${env.ADMIN_PASSWORD ?? ""}`, message);

/** 合言葉を確かめて、通った人に渡す「入っている証」 */
const issueSession = async (env) => {
    const expires = Date.now() + SESSION_HOURS * 60 * 60 * 1000;

    return `${expires}.${await sign(env, String(expires))}`;
};

/** 渡された証が本物で、まだ期限が切れていないか */
const verifySession = async (request, env) => {
    const [expires, signature] = readCookie(request, ADMIN_COOKIE).split(".");
    if (!expires || !signature) return false;
    if (Number(expires) < Date.now()) return false;

    return isSame(signature, await sign(env, expires));
};

/** 合言葉で入っている人か。合言葉が設定されていなければ、誰も入れない */
export const isAdmin = async (request, env) => {
    if (!env.ADMIN_PASSWORD) return false;

    return verifySession(request, env);
};

const buildSessionCookie = (value, secure) =>
    `${ADMIN_COOKIE}=${value}; Path=/; Max-Age=${SESSION_HOURS * 60 * 60}; HttpOnly; SameSite=Lax${
        secure ? "; Secure" : ""
    }`;

const isLoginBlocked = async (env, ipHash) => {
    const row = await env.DB.prepare(
        `SELECT COUNT(*) AS count FROM logins WHERE ip_hash = ?1 AND created_at > ?2`,
    )
        .bind(ipHash, new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60 * 1000).toISOString())
        .first();

    return (row?.count ?? 0) >= LOGIN_FAILURES;
};

const recordLoginFailure = async (env, ipHash) => {
    await env.DB.batch([
        env.DB.prepare(`DELETE FROM logins WHERE created_at < ?1`).bind(
            new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        ),
        env.DB.prepare(`INSERT INTO logins (id, ip_hash, created_at) VALUES (?1, ?2, ?3)`).bind(
            crypto.randomUUID(),
            ipHash,
            new Date().toISOString(),
        ),
    ]);
};

/**
 * 合言葉での出入り。
 *   GET    … いま入っているかどうか
 *   POST   … 合言葉を確かめて、通ったらクッキーを渡す
 *   DELETE … 出る
 */
export const handleAdminSession = async (request, env) => {
    if (request.method === "GET") {
        return jsonResponse({ ok: await isAdmin(request, env) });
    }

    if (request.method === "DELETE") {
        if (!isSameOrigin(request)) return forbidden();

        return jsonResponse({ ok: true }, 200, {
            "set-cookie": `${ADMIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
        });
    }

    if (request.method !== "POST") return methodNotAllowed("GET, POST, DELETE");
    if (!isSameOrigin(request)) return forbidden();

    // 合言葉が設定されていなければ誰も入れない。
    // 設定し忘れたまま、誰でも入れる状態になるのを防ぐ。
    if (!env.ADMIN_PASSWORD) {
        return jsonResponse({ ok: false, message: "合言葉が設定されていません。" }, 503);
    }

    const payload = await readJson(request, 4096);
    if (payload.error) return payload.error;

    const ipHash = await hashIp(request, env);
    if (await isLoginBlocked(env, ipHash)) {
        return jsonResponse(
            {
                ok: false,
                message: "間違いが続いています。しばらく待ってから、もう一度お試しください。",
            },
            429,
        );
    }

    const password = String(payload.data?.password ?? "");
    if (!isSame(password, env.ADMIN_PASSWORD)) {
        await recordLoginFailure(env, ipHash);
        return jsonResponse({ ok: false, message: "合言葉が違います。" }, 401);
    }

    // 本番（https）のときだけ Secure を付ける。
    // 付けっぱなしにすると、ローカル（http）でクッキーが保存されず確認できなくなる。
    const secure = new URL(request.url).protocol === "https:";

    return jsonResponse({ ok: true }, 200, {
        "set-cookie": buildSessionCookie(await issueSession(env), secure),
    });
};
