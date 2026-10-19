# Cloudflare の使い方 — 公開のしくみと作業手順

このサイトは Cloudflare Workers で動いています。記事も画像も Cloudflare D1 に入るため、
**記事が増えてもデプロイは起きません**。デプロイが要るのは、ページ・CSS・JS・Worker の
コードを直したときだけです。

環境構築（Git / Node.js / エディタ）は [CONTRIBUTING.md](./CONTRIBUTING.md)、
書き方の約束は [CODING_RULES.md](./CODING_RULES.md) を参照してください。

## 1. 全体像

```mermaid
flowchart TD
    A["利用者・投稿者<br />アカウント不要"] --> W
    B["運営<br />合言葉で入る"] --> W

    subgraph W["Cloudflare Workers（terraria-jp）★無料枠"]
        P["手書きのページ<br />public/ をそのまま配信（無料・無制限）"]
        D["動く部分（API）<br />一覧・記事・画像・投稿・下見・承認"]
    end

    D -->|読み書き| DB

    subgraph DB["Cloudflare D1（terraria-jp）★無料枠"]
        T1["columns<br />記事（本文・状態・投稿者）"]
        T2["images<br />記事の画像（R2 は使わない）"]
        T3["uploads<br />アップロードの回数（いたずら対策）"]
        T4["logins<br />ログイン失敗の回数"]
    end
```

色分けした図解（ブラウザで開く用）は [`dev/architecture.html`](./dev/architecture.html) にあります。
公開サイトには出ません。ファイルをブラウザで直接開いてください（`dev/parts.html` と同じく、
CSS と共通パーツは相対パスで読み込むので、そのまま動きます）。

| 場所                   | URL                                                 |
| ---------------------- | --------------------------------------------------- |
| サイト                 | https://terraria-jp.terraria-jp-website.workers.dev |
| コラムの投稿           | `/post`                                             |
| コラムの一覧           | `/columns`                                          |
| コラムの承認（運営用） | `/admin/columns`                                    |

記事は「承認待ち」で保存され、運営が承認したものだけが一覧に並びます。
投稿にアカウントは要りません（誰でも投稿できます）。

## 2. 料金が発生しないしくみ

**使うのは Workers と D1 だけ**です。どちらも無料枠を超えると「エラーになる」だけで、
請求は発生しません。使った分だけ請求が来る R2 は使わず、画像も D1 に入れています。

詳しい表と、アプリ側の上限、R2 に移す条件は [README.md](./README.md) の
「料金（無料枠だけで動かす）」にまとめてあります。

守ること:

- **アカウントは Workers Free のまま**にする（支払い方法を登録しない・有料プランに変えない）
- R2・KV・Queues などを足したくなったら、先に運営で相談する
- デプロイ前に `npm run check:free` を通す（有料の設定が混ざっていれば失敗します）

## 3. 初回セットアップ（実施済みの記録）

新しい Cloudflare アカウントで一から作るときの手順です。括弧内は現在の状態です。

| #   | すること                         | コマンド・操作                                                                             | 状態                |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------ | ------------------- |
| 1   | Cloudflare に入る                | `npx wrangler login`（`spawn EPERM` で失敗するときは `--device --browser false`）          | 済み                |
| 2   | D1 を作る                        | `npx wrangler d1 create terraria-jp` → 出た `database_id` を `wrangler.jsonc` に貼る       | 済み（terraria-jp） |
| 3   | 保存場所を作る                   | `npm run db:remote`（`wrangler d1 execute terraria-jp --remote --file=worker/schema.sql`） | 済み                |
| 4   | 動作確認用の記事を入れる（任意） | `npx wrangler d1 execute terraria-jp --remote --file=worker/seed.sql`                      | 済み（5 件）        |
| 5   | 合言葉を登録する                 | `npx wrangler secret put ADMIN_PASSWORD`                                                   | **未**（下記）      |
| 6   | 公開する                         | `npm run deploy`                                                                           | 済み                |

合言葉を登録していない間は、承認ページのログインが 503 で断られます（わざとそうして
います。誰も入れないほうが安全なため）。登録すると、次のリクエストから使えるように
なります。

> 合言葉は運営だけが知る長い文字列にしてください。アシスタントや Issue に貼らないこと。

## 4. ふだんの作業

### 記事を書く・公開する（デプロイ不要）

1. 投稿者が `/post` から書いて送る（アカウント不要）
2. 運営が `/admin/columns` で読んで、公開するかどうかを決める
3. 公開した瞬間から一覧に並ぶ（デプロイは起きない）

### コードを直したとき（デプロイが要る）

```bash
npm run check:free   # 有料の設定が混ざっていないか確かめる
npm run deploy       # Cloudflare Workers へ公開する
```

### 合言葉を変える

```bash
npx wrangler secret put ADMIN_PASSWORD
```

### ローカルで試す

```bash
npm run db:local       # 初回だけ。ローカルに保存場所を作る
npm run db:local:seed  # 任意。動作確認用の記事を入れる
npm run dev            # http://127.0.0.1:8787 で開ける
```

- ローカルの合言葉は `.dev.vars` に書きます（`Copy-Item .dev.vars.example .dev.vars`）。
  `.dev.vars` は Git に入りません。
- `npm run dev` は同時に 1 つだけにしてください。`wrangler d1 execute --local` も同じ
  ファイルを使うため、同時に動かすと `SQLITE_BUSY` で失敗します。

### 保存されている中身を見る

```bash
# 本番（Cloudflare 上）を見る
npx wrangler d1 execute terraria-jp --remote --command "SELECT id, title, status, created_at FROM columns ORDER BY created_at DESC LIMIT 20;"

# ローカルを見る（先に npm run dev を止める）
npx wrangler d1 execute terraria-jp --local --command "SELECT id, title, status FROM columns;"
```

## 5. 承認ページの使い方（運営）

1. `/admin/columns` を開く
2. 合言葉を入れて「入る」（12 時間は入ったままになります）
3. 「承認待ち / 公開中 / 見送り」で表示を切り替える
4. 記事ごとのボタンで決める

| ボタン         | 動き                                   |
| -------------- | -------------------------------------- |
| 公開する       | 一覧に並ぶ                             |
| 見送る         | 公開しない（記録は残る）               |
| 承認待ちに戻す | いったん保留に戻す                     |
| 削除           | 完全に消す（元に戻せません。確認あり） |

5. 終わったら「出る」

合言葉を間違えると、IP ごとに 10 分あたり 5 回までで止まります（その間は 429）。

## 6. つまずいたとき

| 症状                                                       | 原因と対処                                                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 「合言葉が設定されていません。」と出る                     | まだ `npx wrangler secret put ADMIN_PASSWORD` をしていない                                                     |
| 合言葉が通らない                                           | 10 分間に 5 回間違えると止まる。少し待ってから入れ直す                                                         |
| 証明書エラー（ERR_SSL_VERSION_OR_CIPHER_MISMATCH）         | 新しい workers.dev では証明書ができるまで数分かかることがある。待って開き直す                                  |
| `wrangler login` が `spawn EPERM` で失敗する               | `npx wrangler login --device --browser false` を使う                                                           |
| デプロイ時に「register a workers.dev subdomain」と言われる | ダッシュボードでサブドメインを登録する（1 回だけ）                                                             |
| `SQLITE_BUSY` が出る                                       | `npm run dev` と `wrangler d1 execute --local` を同時に動かさない                                              |
| 画像が上がらない（413 / 415 / 507）                        | 1MB 超・画像でない・置き場所がいっぱい。上限は README の表を見る                                               |
| 直したのに公開サイトが変わらない                           | コードは `npm run deploy` が要る。記事は D1 なのでデプロイ不要                                                 |
| ローカルの記事が消えた                                     | `database_id` を変えるとローカルの D1 は作り直される。`npm run db:local` と `npm run db:local:seed` を実行する |
| 料金が請求されていないか不安                               | `npm run check:free` と、ダッシュボードの Billing で Workers Free のままか確認する                             |

## 7. まだ終わっていないこと

- **合言葉の登録**（`npx wrangler secret put ADMIN_PASSWORD`）
- **GitHub Actions**: `origin` がまだ仮の URL（`Pl4ceholder`）なので未着手。本物の
  リポジトリに変えたら、`develop` への push で `npm run check:free` と `npm run deploy` を
  回す形にする（そのとき `CLOUDFLARE_API_TOKEN` を GitHub の secrets に入れる）
- **独自ドメイン**: いまは `workers.dev` の URL。取る場合は Cloudflare でのドメイン取得が
  有料になるため、先に相談する
