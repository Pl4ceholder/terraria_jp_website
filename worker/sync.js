// ==========================================================================
// sync.js — Discord の bot から届くものの、合言葉の確かめ方
//
// 募集・イベント・実績・依頼のどれも、同じ合言葉（SYNC_SECRET）で守る。
// 確かめ方がばらばらにならないよう、ここ 1 か所に置く。
// ==========================================================================

import { jsonResponse } from "./http.js";
import { isSame } from "./signing.js";

/** bot が合言葉を入れてくるヘッダ */
const SYNC_SECRET_HEADER = "x-sync-secret";

/**
 * 合言葉を確かめる。通れば null、通らなければ返すべき返事を返す。
 *
 * 設定していなければ、誰も書き込めない（設定し忘れで開いたままにしない）。
 */
export const checkSyncSecret = (request, env) => {
    if (!env.SYNC_SECRET) {
        return jsonResponse({ ok: false, message: "同期の設定がされていません。" }, 503);
    }

    if (!isSame(request.headers.get(SYNC_SECRET_HEADER) ?? "", env.SYNC_SECRET)) {
        return jsonResponse({ ok: false, message: "受け付けられませんでした。" }, 401);
    }

    return null;
};
