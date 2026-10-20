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

-- いま立っているマルチ募集。
--
-- 持ち主は Discord 側（bot がスレッドを集めて届ける）。ここはその写しなので、
-- 届いた内容で丸ごと入れ替える。bot が止まれば、最後に届いた内容のまま残る。
CREATE TABLE IF NOT EXISTS recruitments (
    -- Discord のスレッド ID
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL DEFAULT '',
    -- 募集を立てたチャンネル（tmod / コンソール / バニラ）
    channel_id TEXT NOT NULL DEFAULT '',
    -- 親のメッセージ ID
    message_id TEXT NOT NULL DEFAULT '',
    -- 募集の種類（モッドマルチ / バニラマルチ）
    mode TEXT NOT NULL DEFAULT '',
    -- 機種（PC / Switch / PS4 / XBOX / モバイル）
    platform TEXT NOT NULL DEFAULT '',
    -- 使う VC の名前
    vc TEXT NOT NULL DEFAULT '',
    -- SteamID か IP:Port（未定なら「なし」）
    connection TEXT NOT NULL DEFAULT '',
    -- ひとこと
    message TEXT NOT NULL DEFAULT '',
    author_id TEXT NOT NULL DEFAULT '',
    author_name TEXT NOT NULL DEFAULT '',
    author_icon TEXT NOT NULL DEFAULT '',
    -- 募集を立てた時刻
    started_at TEXT NOT NULL,
    -- 最後に書き込みがあった時刻。スレッドは、ここから流れる
    last_activity_at TEXT,
    -- 書き込みの数（参加の目安。参加人数そのものではない）
    message_count INTEGER NOT NULL DEFAULT 0,
    -- 「最後の書き込みから何分で流れる」設定（普通は 1440 分＝24 時間）
    archive_minutes INTEGER NOT NULL DEFAULT 0,
    -- Discord から流れる時刻。同期のときに計算して入れる（ページはこれと今を比べるだけ）
    deadline_at TEXT,
    -- 最後に bot から届いた時刻
    synced_at TEXT NOT NULL
);

-- 一覧は「新しい順」で引くので、その形に合わせる
CREATE INDEX IF NOT EXISTS idx_recruitments_started
    ON recruitments (started_at DESC);

-- 「まだ生きているか」で絞るので、その形に合わせる
CREATE INDEX IF NOT EXISTS idx_recruitments_deadline
    ON recruitments (deadline_at);

-- これからの Discord のイベント（サーバーの「イベント」で立てたもの）。
--
-- 募集と同じで、持ち主は Discord 側。届いた内容で丸ごと入れ替える。
-- 終わったイベントの同期はしない（Discord が終わったものを返さなくなるので、
-- 次に届いたときに入れ替わって消える）。
CREATE TABLE IF NOT EXISTS events (
    -- Discord のイベント ID
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    -- 場所（外部のイベントなら場所の名前、ボイスならチャンネル名）
    location TEXT NOT NULL DEFAULT '',
    -- イベントの絵（あれば）
    cover_url TEXT NOT NULL DEFAULT '',
    -- Discord のイベントページ
    url TEXT NOT NULL DEFAULT '',
    -- 参加を表明している人数
    user_count INTEGER NOT NULL DEFAULT 0,
    -- 始まりの時刻。終わりは無いこともある
    start_at TEXT NOT NULL,
    end_at TEXT,
    -- 最後に bot から届いた時刻
    synced_at TEXT NOT NULL
);

-- 「これから」を新しい順ではなく、始まる順に引く
CREATE INDEX IF NOT EXISTS idx_events_start
    ON events (start_at);

-- 実績（Discord の「実績ロール」）。
--
-- 名前は Discord のロール名をそのまま使う（説明やカテゴリは Discord 側にも無い）。
-- 「解放済み」は Discord のロールには出ない（ロールは、いまつけている称号 1 つだけ）ので、
-- bot が Redis から集めて届ける。届いた内容で丸ごと入れ替える。
CREATE TABLE IF NOT EXISTS achievements (
    -- Discord のロール ID
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    -- 並び順（Discord 側の定義の順）
    position INTEGER NOT NULL DEFAULT 0,
    -- 最後に bot から届いた時刻
    synced_at TEXT NOT NULL
);

-- 誰がどの実績を解放したか。1 人 1 行。
--
-- 「いつ解放したか」は Discord 側にも記録が無いので持たない。
-- 解放済みの ID はカンマでつないで持つ（人数ぶんだけ書けばよいので、書き込みが増えない）。
CREATE TABLE IF NOT EXISTS member_achievements (
    -- Discord のユーザー ID
    user_id TEXT PRIMARY KEY,
    -- Discord の表示名（管理画面で相手を選ぶときに使う）
    name TEXT NOT NULL DEFAULT '',
    -- 解放済みの実績 ID（例: "1543500048245981275,1543500112456585267"）
    unlocked TEXT NOT NULL DEFAULT '',
    -- いま称号としてつけている実績 ID（つけていなければ空）
    title TEXT NOT NULL DEFAULT '',
    synced_at TEXT NOT NULL
);

-- Web からの操作の依頼。
--
-- サイトは Discord を触らない。ここに依頼を 1 行置くだけで、bot が 30 秒ごとに
-- 拾って Discord に反映し、結果を書き戻す。依頼は bot が処理するまで残るので、
-- bot が止まっていても操作が消えない。
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

-- 同期の状態を持つ小さな置き場。
-- 募集が 1 件も無いときでも「最後にいつ届いたか」を出せるようにする。
CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
