-- ==========================================================================
-- 004_activities.sql — 「活動ページ」（Discord のスレッド風）の置き場
--
-- 新しく作る DB は schema.sql だけで足りる。こちらは、すでに動いている
-- 本番・ローカルの DB に 1 回だけ流すためのもの。
--
--     npx wrangler d1 execute terraria-jp --remote --file=worker/migrations/004_activities.sql
--     npx wrangler d1 execute terraria-jp --local  --file=worker/migrations/004_activities.sql
--
-- 表を足すだけ（IF NOT EXISTS）なので、2 回流しても何も起きない。
-- ==========================================================================

-- 活動（スレッド）1 本。
--
-- 最初の書き込みは、この行に持つ（スレッドを立てたときの本文）。
-- あとから書き足したものは activity_posts に入れる。
CREATE TABLE IF NOT EXISTS activities (
    -- URL に使う短い ID（/activities/<id>）
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    -- 最初の書き込み。書かれたままの文章（Markdown）と、表示用の HTML
    body_md TEXT NOT NULL,
    body_html TEXT NOT NULL,
    -- 書いた人（Discord でログインした人だけが書ける）
    author_id TEXT NOT NULL,
    author_name TEXT NOT NULL DEFAULT '',
    author_icon TEXT NOT NULL DEFAULT '',
    -- pending（承認待ち） / published（公開） / rejected（見送り）
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    -- 公開した日時。承認までは NULL。
    published_at TEXT,
    -- 最後に書き込みがあった時刻。一覧はこれの新しい順に並べる
    updated_at TEXT NOT NULL,
    -- 公開された書き込みの数（最初の書き込みを含む）
    post_count INTEGER NOT NULL DEFAULT 0,
    -- 投稿者の IP を、サイトごとの鍵で変換したもの（そのままは保存しない）
    ip_hash TEXT NOT NULL DEFAULT ''
);

-- 一覧は「公開されたものを、最後の書き込みが新しい順」で引く
CREATE INDEX IF NOT EXISTS idx_activities_published
    ON activities (status, updated_at DESC);

-- 同じ人から続けて立てられていないかを見るため
CREATE INDEX IF NOT EXISTS idx_activities_author
    ON activities (author_id, created_at);

-- 活動に書き足したもの（2 通目以降）。
CREATE TABLE IF NOT EXISTS activity_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id TEXT NOT NULL,
    body_md TEXT NOT NULL,
    body_html TEXT NOT NULL,
    author_id TEXT NOT NULL,
    author_name TEXT NOT NULL DEFAULT '',
    author_icon TEXT NOT NULL DEFAULT '',
    -- pending（承認待ち） / published（公開） / rejected（見送り）
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    published_at TEXT
);

-- 活動のページは「その活動の、公開された書き込みを古い順」で引く
CREATE INDEX IF NOT EXISTS idx_activity_posts_activity
    ON activity_posts (activity_id, status, id);

-- 同じ人からの書き込みが続いていないかを見るため
CREATE INDEX IF NOT EXISTS idx_activity_posts_author
    ON activity_posts (author_id, created_at);
