-- ==========================================================================
-- schema.sql — コラムの保存場所（Cloudflare D1）
--
-- 使い方（ローカルで試すとき）:
--     npm run db:local
--
-- 本番（Cloudflare 上）に作るとき:
--     npx wrangler d1 execute terraria-jp --remote --file=worker/schema.sql
--
-- 何度実行しても同じ結果になるように書いてある。
-- ==========================================================================

CREATE TABLE IF NOT EXISTS columns (
    -- 記事 1 件の識別子
    id TEXT PRIMARY KEY,
    -- URL になる名前（/columns/<slug>.html）
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    -- 書かれたままの文章（Markdown）
    body_md TEXT NOT NULL,
    -- 表示用に変換した HTML（保存時に 1 回だけ作る）
    body_html TEXT NOT NULL,
    -- 書いた人の名前（任意）
    author TEXT NOT NULL DEFAULT '',
    -- タグ（"初心者,素材" のようにカンマでつなぐ。任意）
    tags TEXT NOT NULL DEFAULT '',
    -- pending（承認待ち） / published（公開） / rejected（見送り）
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    -- 公開した日時。承認までは NULL。
    published_at TEXT,
    -- 投稿者の IP を、サイトごとの鍵で変換したもの（そのままは保存しない）
    ip_hash TEXT NOT NULL DEFAULT ''
);

-- 一覧は「公開されたものを新しい順」で引くので、その形に合わせる
CREATE INDEX IF NOT EXISTS idx_columns_published
    ON columns (status, published_at DESC);

-- 同じ人からの投稿が続いていないかを見るため
CREATE INDEX IF NOT EXISTS idx_columns_ip
    ON columns (ip_hash, created_at);

-- 記事で使う画像。
-- 有料の置き場所（R2）は使わず、記事と同じ D1 に入れる。
-- D1 の無料枠は「上限を超えたら書き込みがエラーになるだけ」で料金は発生しない。
-- 1 行に入るのは 2MB まで、データベース 1 つは 500MB まで。
CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    -- image/png など
    content_type TEXT NOT NULL,
    -- バイト数。合計を数えて、いっぱいになる前に断るために持つ。
    size INTEGER NOT NULL,
    -- 画像そのもの
    data BLOB NOT NULL,
    created_at TEXT NOT NULL
);

-- 画像のアップロードの記録。
-- 誰でも投稿できるぶん、置き場所を荒らされないように回数を数える。
CREATE TABLE IF NOT EXISTS uploads (
    id TEXT PRIMARY KEY,
    ip_hash TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_uploads_ip
    ON uploads (ip_hash, created_at);

-- 合言葉を間違えた記録。
-- 総当たりを防ぐため、間違いが続いたら少し待ってもらう。
CREATE TABLE IF NOT EXISTS logins (
    id TEXT PRIMARY KEY,
    ip_hash TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_logins_ip
    ON logins (ip_hash, created_at);
