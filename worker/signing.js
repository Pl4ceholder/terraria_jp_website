// ==========================================================================
// signing.js — 合言葉の見比べ方、クッキーの読み方、署名の作り方
//
// 運営の合言葉（ADMIN_PASSWORD）と、マイページの入っている証（DISCORD_CLIENT_SECRET）で
// 同じものを使う。鍵は呼ぶ側が渡すので、ここは「鍵で署名する」ことだけを知っている。
//
// 署名は HMAC-SHA256。Web Crypto は Workers でも手元の Node でも同じ結果になるため、
// scripts/check-mypage.mjs がそのまま試せる。
// ==========================================================================

/** 文字列が同じかどうか。全部を見比べて、時間で中身を推測されないようにする */
export const isSame = (a, b) => {
    if (typeof a !== "string" || typeof b !== "string") return false;
    if (a.length !== b.length) return false;

    let difference = 0;
    for (let index = 0; index < a.length; index += 1) {
        difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
    }

    return difference === 0;
};

/** クッキーの中の 1 つを取り出す。無ければ空文字 */
export const readCookie = (request, name) => {
    for (const part of (request.headers.get("cookie") ?? "").split(";")) {
        const separator = part.indexOf("=");
        if (separator !== -1 && part.slice(0, separator).trim() === name) {
            return part.slice(separator + 1).trim();
        }
    }

    return "";
};

/** 鍵で署名する。鍵が違えば、まったく違う印になる */
export const signWithKey = async (key, message) => {
    const imported = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(key),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", imported, new TextEncoder().encode(message));

    return [...new Uint8Array(signature)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
};
