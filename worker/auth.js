// ==========================================================================
// auth.js — マイページの Discord ログイン（OAuth2）と、入っている証
//
// マイページは「自分の実績」を見る場所なので、誰が見ているのかを知る必要がある。
// そのためだけに Discord の OAuth2 を使う。取る権限は identify だけで、ユーザー ID・
// 表示名・アイコンしか読まない（メールなどは取らない）。
//
// 流れ:
//   1. GET /auth/discord ……… 合言葉（state）を作ってクッキーに入れ、Discord へ送る
//   2. GET /auth/discord/callback ……… state を確かめ、code を証（トークン）に換え、
//      /users/@me を読んで、入っている証をクッキーに入れてマイページへ戻す
//
// 入っている証は署名つきの文字列（HMAC-SHA256）で、中身はクッキーに入れて持ち回る。
// サーバー側に置き場所を作らないので、D1 を使わない（無料枠の書き込みを増やさない）。
//
// 証の鍵は DISCORD_CLIENT_SECRET から作る。secret を増やさずに済むうえ、Discord 側で
// 作り直せば、そのときに全員のログインが切れる。合言葉（ADMIN_PASSWORD）とは混ざらない。
//
// DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET が無いときは、どの入口も 503 で断る
// （設定し忘れたまま、誰でも入れる状態にならないように）。
// ==========================================================================

import { isSame, readCookie, signWithKey } from "./signing.js";

/** 入っている証を入れておくクッキー */
export const USER_COOKIE = "mypage_user";

/** 行き来の間にだけ使う合言葉（state）のクッキー */
export const STATE_COOKIE = "mypage_state";

/** 入っている証の期限（日）。自分の実績を見るだけなので、長めにする */
const USER_SESSION_DAYS = 30;

/** 合言葉（state）の期限（分）。行き来の間に切れるくらいでよい */
export const STATE_MINUTES = 10;

/** 表示名の長さ（Discord の表示名は 32 文字まで） */
const NAME_MAX = 32;

const AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const TOKEN_URL = "https://discord.com/api/oauth2/token";
const ME_URL = "https://discord.com/api/users/@me";

/** 署名につける区切り。別の用途の署名と取り違えないようにする */
const SIGN_PURPOSE = "mypage:";

/** ログインの設定が済んでいるか。片方でも欠けたら、入口を閉じる */
export const isConfigured = (env) => Boolean(env?.DISCORD_CLIENT_ID && env?.DISCORD_CLIENT_SECRET);

/** Discord から戻ってくる先。そのときのオリジンから作る（本番もローカルも同じ形） */
export const redirectUriOf = (request) => new URL("/auth/discord/callback", request.url).href;

/** 本番（https）のときだけ Secure を付ける。ローカル（http）では付けない */
export const isSecure = (request) => new URL(request.url).protocol === "https:";

/** 行き来の間に使う、当てずっぽうでは当たらない文字列 */
export const makeState = () => crypto.randomUUID().replaceAll("-", "");

/** Discord の認証画面への行き先 */
export const buildAuthorizeUrl = ({ clientId, redirectUri, state }) => {
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "identify");
    url.searchParams.set("state", state);
    // 毎回、どのアカウントで入るかを選べるようにする（入れ直しができないと詰むため）
    url.searchParams.set("prompt", "consent");

    return url.href;
};

/** code を、Discord を読みに行くための証（トークン）に換える */
export const exchangeCode = async ({
    code,
    clientId,
    clientSecret,
    redirectUri,
    fetchImpl = fetch,
}) => {
    try {
        const response = await fetchImpl(TOKEN_URL, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                grant_type: "authorization_code",
                code,
                redirect_uri: redirectUri,
            }),
        });

        if (!response.ok) return { error: `トークンをもらえませんでした（${response.status}）` };

        const data = await response.json();
        if (!data?.access_token) return { error: "トークンが空でした。" };

        return { data: { accessToken: String(data.access_token) } };
    } catch (error) {
        return { error: `Discord とやりとりできませんでした（${error}）` };
    }
};

/** トークンから、入った人の中身（ID・表示名・アイコン）を読む */
export const fetchUser = async ({ accessToken, fetchImpl = fetch }) => {
    try {
        const response = await fetchImpl(ME_URL, {
            headers: { authorization: `Bearer ${accessToken}` },
        });

        if (!response.ok) return { error: `アカウントを読めませんでした（${response.status}）` };

        const data = await response.json();
        if (!data?.id) return { error: "アカウントの ID が空でした。" };

        return { data: toUser(data) };
    } catch (error) {
        return { error: `Discord とやりとりできませんでした（${error}）` };
    }
};

/** Discord の返事を、このサイトで使う形にする */
export const toUser = (data) => {
    const id = String(data?.id ?? "");
    // 表示名（global_name）が無い人もいるので、そのときはアカウント名を使う
    const name = String(data?.global_name || data?.username || "名前なし");

    return {
        id,
        name: name.trim().slice(0, NAME_MAX),
        avatar: avatarUrlOf(id, data?.avatar),
    };
};

/** アイコンの URL。設定していない人には、Discord の既定のアイコンを使う */
const avatarUrlOf = (id, hash) =>
    hash
        ? `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=128`
        : `https://cdn.discordapp.com/embed/avatars/${defaultAvatar(id)}.png`;

/** 既定のアイコンの番号（0〜5）。ID から決まるので、毎回同じ絵になる */
const defaultAvatar = (id) => {
    try {
        return Number((BigInt(id) >> 22n) % 6n);
    } catch {
        return 0;
    }
};

/** 入っている証を作る。`now` を渡せるのは、期限切れを手元で確かめるため */
export const issueUserSession = async (
    env,
    user,
    { now = Date.now(), days = USER_SESSION_DAYS } = {},
) => {
    const expires = now + days * 24 * 60 * 60 * 1000;
    const payload = toBase64Url(JSON.stringify(user));

    return `${expires}.${payload}.${await signUser(env, `${expires}.${payload}`)}`;
};

/**
 * ログインしたあとの行き先として使ってよいか（このサイトの中の道だけ）。
 *
 * 「//example.com」のような、よそのサイトへ飛ばす書き方（open redirect）は通さない。
 * 使えないときは空を返す（呼んだ側はマイページへ戻す）。
 */
export const safeNext = (value) => {
    const next = String(value ?? "");
    if (!next.startsWith("/") || next.startsWith("//")) return "";
    if (next.length > 200) return "";
    // 改行や「\」が混ざったものは、場所として使わない（ヘッダに乗せるため）
    if (/[\u0000-\u001f\\]/.test(next)) return "";

    try {
        // 「/activities/new」のような、このサイトの中の道だけを通す
        return new URL(next, "https://example.invalid").origin === "https://example.invalid"
            ? next
            : "";
    } catch {
        return "";
    }
};

/** 合言葉（state）のクッキーに入れる値。戻り先があるときだけ、あとに付ける */
export const buildStateValue = (state, next = "") => {
    const safe = safeNext(next);

    return safe ? `${state}.${toBase64Url(safe)}` : state;
};

/** クッキーから、合言葉と戻り先を読む。読めない戻り先は空にする */
const readStateValue = (request) => {
    const [state, encoded = ""] = readCookie(request, STATE_COOKIE).split(".");
    if (!encoded) return { state, next: "" };

    try {
        return { state, next: safeNext(fromBase64Url(encoded)) };
    } catch {
        return { state, next: "" };
    }
};

/** 戻ってきた合言葉（state）が、こちらで作ったものか。他所から押し込まれたものは断る */
export const isSameState = (request, params) => {
    const { state } = readStateValue(request);

    return Boolean(state) && isSame(params.get("state") ?? "", state);
};

/** ログインし終わったあとの行き先。指定が無ければマイページ */
export const nextAfterLogin = (request) => readStateValue(request).next || "/mypage";

/** 入っている証が本物で、まだ切れていないか。切れていたら null */
export const readUserSession = async (request, env) => {
    if (!isConfigured(env)) return null;

    const [expires, payload, signature] = readCookie(request, USER_COOKIE).split(".");
    if (!expires || !payload || !signature) return null;
    if (!Number(expires) || Number(expires) < Date.now()) return null;
    if (!isSame(signature, await signUser(env, `${expires}.${payload}`))) return null;

    try {
        const user = JSON.parse(fromBase64Url(payload));
        if (!user?.id || !user?.name) return null;

        return {
            id: String(user.id),
            name: String(user.name),
            avatar: String(user.avatar ?? ""),
        };
    } catch {
        return null;
    }
};

/** 証の印。鍵が違えば、まったく違う印になる */
const signUser = (env, message) =>
    signWithKey(`${SIGN_PURPOSE}${env.DISCORD_CLIENT_SECRET ?? ""}`, message);

export const buildUserCookie = (value, secure) =>
    `${USER_COOKIE}=${value}; Path=/; Max-Age=${USER_SESSION_DAYS * 24 * 60 * 60}; HttpOnly; SameSite=Lax${
        secure ? "; Secure" : ""
    }`;

export const clearUserCookie = () => `${USER_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;

export const buildStateCookie = (value, secure) =>
    `${STATE_COOKIE}=${value}; Path=/; Max-Age=${STATE_MINUTES * 60}; HttpOnly; SameSite=Lax${
        secure ? "; Secure" : ""
    }`;

export const clearStateCookie = () => `${STATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;

/**
 * 文字列を、URL に入れられる形（base64url）にする。
 *
 * 表示名に日本語が入るので、文字のままではなく UTF-8 のバイトにしてから変換する
 * （btoa は 1 バイト文字しか扱えない）。
 */
const toBase64Url = (text) => {
    let binary = "";
    for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);

    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

/** その反対。壊れていても、読めない文字にならないようにする */
const fromBase64Url = (value) => {
    const padded = value
        .replaceAll("-", "+")
        .replaceAll("_", "/")
        .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);

    return new TextDecoder().decode(
        Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    );
};
