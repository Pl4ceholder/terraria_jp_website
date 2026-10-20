// ==========================================================================
// values.js — 外から届いた値を、保存・表示できる形に整える
//
// bot から届く JSON や、フォームから届く文字は、こちらの型を約束しない。
// 長さを切り、数を整数にし、日時を ISO の形にそろえる。同じ整え方を
// 何度も書かないよう、ここ 1 か所に置く。
// ==========================================================================

/** 前後の空白を落とす */
export const trimText = (value) => String(value ?? "").trim();

/** 前後の空白を落として、max 文字までにする */
export const trimTo = (value, max) => trimText(value).slice(0, max);

/** 日時を ISO の形にする。読めないときは、代わりの時刻にする */
export const toIso = (value, fallback) => {
    const time = Date.parse(String(value ?? ""));

    return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
};

/** 人数のような数を、安全な整数にする（0 未満と小数は 0 扱い） */
export const toCount = (value) => {
    const count = Number(value);

    return Number.isInteger(count) && count > 0 ? count : 0;
};
