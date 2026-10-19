-- ==========================================================================
-- 002_achievements.sql — すでに動いている DB へ、実績の置き場を足す
--
-- 新しく作る DB は schema.sql だけで足りる。こちらは、すでに動いている
-- 本番・ローカルの DB に 1 回だけ流すためのもの。
--
--     npx wrangler d1 execute terraria-jp --remote --file=worker/migrations/002_achievements.sql
--     npx wrangler d1 execute terraria-jp --local  --file=worker/migrations/002_achievements.sql
--
-- 何度流しても同じ結果になる（IF NOT EXISTS）。
-- ==========================================================================

-- 実績（Discord の「実績ロール」）。名前は Discord のロール名をそのまま使う
CREATE TABLE IF NOT EXISTS achievements (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    synced_at TEXT NOT NULL
);

-- 誰がどの実績を解放したか。1 人 1 行
CREATE TABLE IF NOT EXISTS member_achievements (
    user_id TEXT PRIMARY KEY,
    unlocked TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    synced_at TEXT NOT NULL
);
