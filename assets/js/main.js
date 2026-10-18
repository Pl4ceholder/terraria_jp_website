// ==========================================================================
// main.js — Terraria JP 公式サイト 共通スクリプト（仮）
// サイト全体で使う処理をここに足していく。
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
    // フッターの年号を自動で更新する
    // 例) <span data-current-year></span>
    const year = document.querySelector("[data-current-year]");
    if (year) {
        year.textContent = String(new Date().getFullYear());
    }
});
