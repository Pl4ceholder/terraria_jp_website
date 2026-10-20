// ==========================================================================
// check-mypage.mjs — マイページのログイン（Discord の OAuth2 と、入っている証）を手元で確かめる
//
// 確かめるのは 4 つ。
//   1. 設定がそろっていなければ、入口を閉じるか（worker/auth.js の isConfigured）
//   2. Discord の認証画面へ、必要なものを付けて送れるか（同じファイルの buildAuthorizeUrl）
//   3. 入っている証を、そのまま読み戻せるか（issueUserSession / readUserSession）
//   4. 書き換え・期限切れ・別の鍵の証を、ちゃんと断るか
//
// Discord へは行かない。code の交換とアカウントの読み取りは、返事をまねたもので試す
// （exchangeCode / fetchUser に fetch を渡せるようにしてある）。
//
// 使い方: npm run check:mypage
// ==========================================================================

import {
    buildAuthorizeUrl,
    buildStateCookie,
    buildUserCookie,
    clearStateCookie,
    clearUserCookie,
    exchangeCode,
    fetchUser,
    isConfigured,
    isSameState,
    issueUserSession,
    makeState,
    readUserSession,
    redirectUriOf,
    STATE_COOKIE,
    STATE_MINUTES,
    toUser,
    USER_COOKIE,
} from "../worker/auth.js";

const ENV = { DISCORD_CLIENT_ID: "1234567890", DISCORD_CLIENT_SECRET: "s3cret-value" };
const REDIRECT = "https://example.com/auth/discord/callback";

/** クッキーを付けた、ページを開いたときのようなもの */
const fakeRequest = (url, cookies = {}) => ({
    url,
    headers: {
        get: (name) =>
            name.toLowerCase() === "cookie"
                ? Object.entries(cookies)
                      .map(([key, value]) => `${key}=${value}`)
                      .join("; ")
                : null,
    },
});

/** Discord の返事をまねたもの */
const fakeFetch = (answer) => {
    const seen = {};

    return {
        seen,
        fetchImpl: async (url, init) => {
            seen.url = url;
            seen.init = init;

            return answer;
        },
    };
};

const okJson = (data) => ({ ok: true, status: 200, json: async () => data });

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

// --- 1. 設定の有無で入口を開け閉めする -------------------------------------

check("設定がそろっていれば、ログインを開く", isConfigured(ENV) === true);
check(
    "CLIENT ID が無ければ、ログインを閉じる",
    isConfigured({ ...ENV, DISCORD_CLIENT_ID: undefined }) === false,
);
check(
    "CLIENT SECRET が空なら、ログインを閉じる",
    isConfigured({ ...ENV, DISCORD_CLIENT_SECRET: "" }) === false,
);
check("何も設定されていなければ、ログインを閉じる", isConfigured({}) === false);

// --- 2. Discord の認証画面へ送るときの形 -----------------------------------

const authorize = new URL(
    buildAuthorizeUrl({ clientId: ENV.DISCORD_CLIENT_ID, redirectUri: REDIRECT, state: "abc123" }),
);

check(
    "認証画面へ、必要なものを付けて送る",
    authorize.origin + authorize.pathname === "https://discord.com/oauth2/authorize" &&
        authorize.searchParams.get("client_id") === ENV.DISCORD_CLIENT_ID &&
        authorize.searchParams.get("redirect_uri") === REDIRECT &&
        authorize.searchParams.get("response_type") === "code" &&
        authorize.searchParams.get("state") === "abc123",
    authorize.href,
);
check(
    "取る権限は identify だけ（メールなどは取らない）",
    authorize.searchParams.get("scope") === "identify",
    authorize.searchParams.get("scope"),
);
check(
    "戻ってくる先は、そのときのオリジンから作る",
    redirectUriOf(fakeRequest("http://127.0.0.1:8787/mypage")) ===
        "http://127.0.0.1:8787/auth/discord/callback" &&
        redirectUriOf(fakeRequest("https://terraria-jp.example.com/mypage")) ===
            "https://terraria-jp.example.com/auth/discord/callback",
    redirectUriOf(fakeRequest("https://terraria-jp.example.com/mypage")),
);

// --- 3. 行き来の合言葉（state） ---------------------------------------------

const state = makeState();
const withState = fakeRequest("https://example.com/auth/discord/callback", {
    [STATE_COOKIE]: state,
});

check("合言葉は、当てずっぽうでは当たらない長さにする", state.length >= 16, state);
check("合言葉は、毎回ちがう", makeState() !== makeState());
check(
    "戻ってきた合言葉が合っていれば通す",
    isSameState(withState, new URLSearchParams({ state })) === true,
);
check(
    "合わない合言葉は断る",
    isSameState(withState, new URLSearchParams({ state: "chigau" })) === false,
);
check(
    "合言葉を付けていないものは断る",
    isSameState(
        fakeRequest("https://example.com/auth/discord/callback"),
        new URLSearchParams({ state }),
    ) === false,
);
check(
    "クッキーに合言葉が無ければ断る",
    isSameState(
        fakeRequest("https://example.com/auth/discord/callback", {}),
        new URLSearchParams(),
    ) === false,
);

// --- 4. 入っている証 --------------------------------------------------------

const user = {
    id: "1543494481603596441",
    name: "てすと太郎",
    avatar: "https://cdn.discordapp.com/avatars/1543494481603596441/abc.png?size=128",
};

const session = await issueUserSession(ENV, user);
const back = await readUserSession(
    fakeRequest("https://example.com/mypage", { [USER_COOKIE]: session }),
    ENV,
);

check(
    "入っている証を、そのまま読み戻せる",
    back?.id === user.id && back?.name === user.name && back?.avatar === user.avatar,
    JSON.stringify(back),
);
check("日本語の表示名も、そのまま持ち回れる", back?.name === "てすと太郎", back?.name);

const [expires, payload, signature] = session.split(".");
const forged = `${expires}.${Buffer.from(
    JSON.stringify({ ...user, id: "9999999999999999999" }),
).toString("base64url")}.${signature}`;

check(
    "中身を書き換えた証は通らない（他人の ID にすり替えられない）",
    (await readUserSession(
        fakeRequest("https://example.com/mypage", { [USER_COOKIE]: forged }),
        ENV,
    )) === null,
);
check(
    "別の鍵で作った証は通らない",
    (await readUserSession(fakeRequest("https://example.com/mypage", { [USER_COOKIE]: session }), {
        ...ENV,
        DISCORD_CLIENT_SECRET: "another-secret",
    })) === null,
);
check(
    "期限が切れた証は通らない",
    (await readUserSession(
        fakeRequest("https://example.com/mypage", {
            [USER_COOKIE]: await issueUserSession(ENV, user, {
                now: Date.now() - 31 * 24 * 60 * 60 * 1000,
            }),
        }),
        ENV,
    )) === null,
);
check(
    "設定が無ければ、証があっても入れない",
    (await readUserSession(
        fakeRequest("https://example.com/mypage", { [USER_COOKIE]: session }),
        {},
    )) === null,
);

const brokenCookies = ["", "abc", "1.2", "1.2.3.4", "abc.def.ghi", "...."].map(async (value) => {
    const found = await readUserSession(
        fakeRequest("https://example.com/mypage", value ? { [USER_COOKIE]: value } : {}),
        ENV,
    );

    return found === null;
});

check("壊れたクッキーでも、落ちずに断る", (await Promise.all(brokenCookies)).every(Boolean));

// --- 5. クッキーの形 --------------------------------------------------------

const userCookie = buildUserCookie("v", true);

check(
    "証のクッキーは、外から触れない形で渡す",
    userCookie.includes("HttpOnly") &&
        userCookie.includes("SameSite=Lax") &&
        userCookie.includes("Secure"),
    userCookie,
);
check(
    "ローカルの http では Secure を付けない（保存されなくなるため）",
    buildUserCookie("v", false).includes("Secure") === false,
    buildUserCookie("v", false),
);
check("出るときは、証を消す", clearUserCookie().includes("Max-Age=0"), clearUserCookie());
check(
    "行き来の合言葉は、短い間だけ持つ",
    buildStateCookie("abc", true).includes(`Max-Age=${STATE_MINUTES * 60}`) &&
        clearStateCookie().includes("Max-Age=0"),
    buildStateCookie("abc", true),
);

// --- 6. code の交換と、アカウントの読み取り ---------------------------------

const tokenAnswer = fakeFetch(okJson({ access_token: "tok-123", token_type: "Bearer" }));
const token = await exchangeCode({
    code: "code-1",
    clientId: ENV.DISCORD_CLIENT_ID,
    clientSecret: ENV.DISCORD_CLIENT_SECRET,
    redirectUri: REDIRECT,
    fetchImpl: tokenAnswer.fetchImpl,
});

check(
    "code を、Discord を読みに行く証（トークン）に換えられる",
    token.data?.accessToken === "tok-123",
    JSON.stringify(token),
);
check(
    "換えるとき、送る先と中身が正しい",
    tokenAnswer.seen.url === "https://discord.com/api/oauth2/token" &&
        tokenAnswer.seen.init.method === "POST" &&
        tokenAnswer.seen.init.body.get("grant_type") === "authorization_code" &&
        tokenAnswer.seen.init.body.get("code") === "code-1" &&
        tokenAnswer.seen.init.body.get("redirect_uri") === REDIRECT,
    JSON.stringify({ url: tokenAnswer.seen.url, body: String(tokenAnswer.seen.init.body) }),
);

const refused = await exchangeCode({
    code: "code-2",
    clientId: ENV.DISCORD_CLIENT_ID,
    clientSecret: ENV.DISCORD_CLIENT_SECRET,
    redirectUri: REDIRECT,
    fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({}) }),
});

check(
    "断られたときは、理由を返す（落ちない）",
    typeof refused.error === "string",
    JSON.stringify(refused),
);

const unreachable = await exchangeCode({
    code: "code-3",
    clientId: ENV.DISCORD_CLIENT_ID,
    clientSecret: ENV.DISCORD_CLIENT_SECRET,
    redirectUri: REDIRECT,
    fetchImpl: async () => {
        throw new Error("つながらない");
    },
});

check("つながらないときも、理由を返す（落ちない）", typeof unreachable.error === "string");

const meAnswer = fakeFetch(
    okJson({
        id: "1543494481603596441",
        username: "taro",
        global_name: "てすと太郎",
        avatar: "abc",
    }),
);
const found = await fetchUser({ accessToken: "tok-123", fetchImpl: meAnswer.fetchImpl });

check(
    "表示名とアイコンを読める",
    found.data?.name === "てすと太郎" &&
        found.data?.avatar ===
            "https://cdn.discordapp.com/avatars/1543494481603596441/abc.png?size=128",
    JSON.stringify(found.data),
);
check(
    "読むとき、トークンを付けて送る",
    meAnswer.seen.init.headers.authorization === "Bearer tok-123",
    JSON.stringify(meAnswer.seen.init.headers),
);

// --- 7. Discord の返事を、このサイトの形にする ------------------------------

check(
    "表示名（global_name）が無ければ、アカウント名を使う",
    toUser({ id: "1", username: "taro" }).name === "taro",
);
check(
    "アイコンを設定していなければ、Discord の既定のアイコンにする",
    /\/embed\/avatars\/[0-5]\.png$/.test(
        toUser({ id: "1543494481603596441", username: "taro" }).avatar,
    ),
    toUser({ id: "1543494481603596441", username: "taro" }).avatar,
);
check(
    "長すぎる表示名は、決めた長さで切る",
    toUser({ id: "1", username: "あ".repeat(100) }).name.length === 32,
    `長さ: ${toUser({ id: "1", username: "あ".repeat(100) }).name.length}`,
);
check(
    "ID が数字でなくても、落ちずにアイコンを作れる",
    toUser({ id: "abc", username: "taro" }).avatar.endsWith(".png"),
);

if (failed === 0) {
    console.log("マイページのログインは、期待どおりです。");
} else {
    console.log(`${failed} 件が期待と違います。`);
    process.exitCode = 1;
}
