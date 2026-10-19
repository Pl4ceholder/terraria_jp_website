-- ==========================================================================
-- 001_recruit_activity.sql — すでに動いている保存場所へ、募集の「流れる時刻」を足す
--
-- 新しく作るときは worker/schema.sql だけで足りる（このファイルは要らない）。
-- すでに動いている DB にだけ、次を 1 回実行する。
--
--     npx wrangler d1 execute terraria-jp --local  --file=worker/migrations/001_recruit_activity.sql
--     npx wrangler d1 execute terraria-jp --remote --file=worker/migrations/001_recruit_activity.sql
--
-- 一度実行したら、もう流さない（2 回目は「列がもうある」でエラーになる）。
-- 途中で止まったときは、上の 4 行のうち通っていないものを 1 行ずつ流し直す。
-- 増える列には既定値が入るので、すでに入っている募集は消えない。
-- ==========================================================================

ALTER TABLE recruitments ADD COLUMN last_activity_at TEXT;
ALTER TABLE recruitments ADD COLUMN message_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recruitments ADD COLUMN archive_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recruitments ADD COLUMN deadline_at TEXT;
CREATE INDEX IF NOT EXISTS idx_recruitments_deadline ON recruitments (deadline_at);
