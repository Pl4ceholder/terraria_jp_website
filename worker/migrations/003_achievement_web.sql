-- ==========================================================================
-- 003_achievement_web.sql — Web から実績を付ける・称号を着け外すための置き場
--
-- 新しく作る DB は schema.sql だけで足りる。こちらは、すでに動いている
-- 本番・ローカルの DB に 1 回だけ流すためのもの。
--
--     npx wrangler d1 execute terraria-jp --remote --file=worker/migrations/003_achievement_web.sql
--     npx wrangler d1 execute terraria-jp --local  --file=worker/migrations/003_achievement_web.sql
--
-- 注意: 列の追加は 2 回目でエラーになる（SQLite に「無ければ足す」が無い）。
--       1 回だけ流すこと。テーブルの作成は IF NOT EXISTS なので何度でも流せる。
-- ==========================================================================

-- 管理画面で相手を名前で選べるようにする（Discord の表示名）。
-- 実績を持っている人だけを送るので、ここに名前が増えるのは実績持ちの人だけ。
ALTER TABLE member_achievements ADD COLUMN name TEXT NOT NULL DEFAULT '';

-- Web からの操作の依頼。
--
-- サイトは Discord を触らない。ここに依頼を 1 行置くだけで、bot が 30 秒ごとに
-- 拾って Discord に反映し、結果を書き戻す（bot 側は cogs/sync.py）。
CREATE TABLE IF NOT EXISTS achievement_requests (
    -- 依頼の番号（古い順に処理する）
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- title（称号の着脱） / unlock（実績の付与・剥奪）
    kind TEXT NOT NULL,
    -- title: set / clear ／ unlock: grant / revoke
    action TEXT NOT NULL,
    -- 相手の Discord のユーザー ID
    user_id TEXT NOT NULL,
    -- 称号・実績のロール ID（外すときは空）
    role_id TEXT NOT NULL DEFAULT '',
    -- どこから来た依頼か（mypage / admin）
    source TEXT NOT NULL DEFAULT '',
    requested_at TEXT NOT NULL,
    -- pending（依頼中） / done（反映した） / failed（失敗） / expired（古すぎた）
    status TEXT NOT NULL DEFAULT 'pending',
    finished_at TEXT,
    -- 画面に出す理由（失敗したとき）
    message TEXT NOT NULL DEFAULT ''
);

-- bot は「まだ処理していないもの」を古い順に引く
CREATE INDEX IF NOT EXISTS idx_achievement_requests_status
    ON achievement_requests (status, id);

-- 画面は「その人の依頼」を新しい順に引く
CREATE INDEX IF NOT EXISTS idx_achievement_requests_user
    ON achievement_requests (user_id, id DESC);
