// ==========================================================================
// http.js — 返事の形と、送られてきたものを読む道具
//
// Worker のあちこちで同じ形の返事を書かないよう、ここにそろえる。
// 画面（HTML）・API（JSON）・移動（303）の 3 つと、フォーム／JSON の読み取り。
// ==========================================================================

/** JSON を返す */
export const jsonResponse = (data, status = 200, headers = {}) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { "content-type": "application/json; charset=utf-8", ...headers },
    });

/** HTML を返す。公開・取り下げがすぐ見えるように、長く持たせない */
export const htmlResponse = (html, status = 200) =>
    new Response(html, {
        status,
        headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-cache",
        },
    });

/** 移動のお知らせ。クッキーを複数付けられるように Headers を組み立てる */
export const redirectTo = (location, cookies = []) => {
    const headers = new Headers({ location });
    for (const cookie of cookies) headers.append("set-cookie", cookie);

    return new Response(null, { status: 303, headers });
};

/** そのメソッドでは受け付けない */
export const methodNotAllowed = (allow) =>
    new Response(JSON.stringify({ ok: false, message: `${allow} で送ってください。` }), {
        status: 405,
        headers: { "content-type": "application/json; charset=utf-8", allow },
    });

/** フォームを読む。壊れていても、ページを出せるようにする */
export const readForm = async (request) => {
    try {
        return { data: await request.formData() };
    } catch {
        return { error: "送信された内容を読めませんでした。" };
    }
};

/** JSON を読む。大きすぎるものは読み込まずに断る */
export const readJson = async (request, maxBytes) => {
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > maxBytes) {
        return {
            error: jsonResponse({ ok: false, message: "送信された内容が大きすぎます。" }, 413),
        };
    }

    try {
        return { data: await request.json() };
    } catch {
        return {
            error: jsonResponse({ ok: false, message: "送信された内容を読めませんでした。" }, 400),
        };
    }
};

/** 別のサイトから勝手に送られたものではないか（クッキーを使う操作の護り） */
export const isSameOrigin = (request) => {
    const origin = request.headers.get("origin");

    return origin === null || origin === new URL(request.url).origin;
};

export const unauthorized = () =>
    jsonResponse({ ok: false, message: "合言葉を入れてください。" }, 401);

export const forbidden = () =>
    jsonResponse({ ok: false, message: "受け付けられませんでした。" }, 403);
