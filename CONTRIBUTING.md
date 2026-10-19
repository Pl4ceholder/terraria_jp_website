# 開発への参加手順 — 環境構築から最初の PR まで

新しく開発に参加する人向けの手順です。上から順に進めれば開発を始められます。
コーディングの書き方は [CODING_RULES.md](./CODING_RULES.md)、Cloudflare の扱いは
[CLOUDFLARE.md](./CLOUDFLARE.md) を参照してください。

## 1. 必要なもの

| ツール                | バージョン       | 確認コマンド    | 備考                                       |
| --------------------- | ---------------- | --------------- | ------------------------------------------ |
| Git                   | 2.40 以上        | `git --version` | 確認済み環境: 2.53.0                       |
| Node.js               | **20.19.0 以上** | `node -v`       | 確認済み環境: v24.20.0。LTS 版を推奨       |
| VS Code               | 最新             | -               | 任意。推奨設定を同梱しているので推奨       |
| ブラウザ              | 最新             | -               | Chrome / Edge / Firefox / Safari           |
| Cloudflare アカウント | -                | -               | **公開する人だけ**。無料プランのままでよい |

Node.js の最低バージョンは同梱ツールの都合で決まっています（`stylelint@17` が
`>=20.19.0` を要求）。`package.json` の `engines` に記載済みなので、古い Node だと
`npm install` 時に警告が出ます。

ページの確認には **Wrangler**（Cloudflare の公式ツール。`npm install` で入ります）を
使います。ビルドツールは不要です。

## 2. セットアップ手順

### 手順 1: リポジトリを取得する

```bash
git clone https://github.com/Pl4ceholder/terraria_jp_website.git
cd terraria_jp_website
```

### 手順 2: 作業ブランチを切る

```bash
git switch develop
git pull
git switch -c feature/#<issue番号>_<内容>
```

ブランチの役割:

| ブランチ                      | 役割                                   |
| ----------------------------- | -------------------------------------- |
| `main`                        | 公開用。直接コミットしない             |
| `develop`                     | 開発の統合先。`feature` はここに集める |
| `feature/#<issue番号>_<内容>` | 作業用。1 つの issue につき 1 つ作る   |

- ブランチ名の規則: `feature/#<issue番号>_<内容>`（例: `feature/#1_ひな形作成`）
- `main` と `develop` へは直接コミットせず、必ず `feature` ブランチで作業する
- 作業を始める前に `develop` の最新を取り込む

### 手順 3: 依存関係をインストールする

```bash
npm install
```

Stylelint（エディタでの検査）と Wrangler（ローカルでの確認）に必要です。
`package-lock.json` と完全に同じ状態にしたい場合は `npm ci` を使います。

### 手順 4: 推奨拡張機能を入れる（VS Code）

VS Code でこのフォルダを開くと、推奨拡張機能の通知が出ます。インストールしてください。

- Prettier（整形）
- Stylelint（CSS 検査）
- EditorConfig

同梱の `.vscode/settings.json` により、保存時に自動で整形・検査されます。
ツール用の設定ファイル（`.prettierrc` など）は Explorer では非表示にしています。

### 手順 5: 保存時の動作を確認する

CSS ファイル（例: `public/assets/css/common/variables.css`）を開いて保存してみてください。

- Prettier が効いていれば、インデントが 4 スペースに揃う
- Stylelint が効いていれば、クラス名の付け方などに警告が出る（問題がなければ何も出ない）

### 手順 6: ローカルで動かす

このサイトは記事を Cloudflare D1 に保存するため、**ファイルを直接開くだけでは確認できません**
（コラムの一覧・記事・投稿フォーム・承認ページは Worker が組み立てて返しています）。
次の手順でローカルのサーバーを立てます。

```bash
npm run db:local        # 初回だけ。ローカルの保存場所を作る
npm run db:local:seed   # 任意。動作確認用の記事を 5 件入れる
npm run dev             # サーバーが立ち上がる
```

ブラウザで `http://127.0.0.1:8787` を開いてください。

| 見たいもの       | URL                                   |
| ---------------- | ------------------------------------- |
| トップページ     | `/`                                   |
| コラムの一覧     | `/columns`                            |
| コラムの投稿     | `/post`                               |
| コラムの承認     | `/admin/columns`                      |
| 共通パーツの確認 | `dev/parts.html` をブラウザで直接開く |

承認ページを試すには、`.dev.vars` を作って合言葉を入れてから `npm run dev` を起動します。

```powershell
Copy-Item .dev.vars.example .dev.vars
```

`.dev.vars` は Git に入りません（`.gitignore` 済み）。

止めるときは、サーバーを立てたターミナルで `Ctrl + C` を押します。
**`npm run dev` は同時に 1 つだけ**にしてください。`npm run db:local` も同じファイルを使う
ため、同時に動かすと `SQLITE_BUSY` で失敗します。

## 3. Windows を使っている人へ（重要）

PowerShell の実行ポリシーが `Restricted` の環境では、`npm` コマンドが次のエラーで失敗します。

```
npm : このシステムではスクリプトの実行が無効になっているため、
ファイル C:\Program Files\nodejs\npm.ps1 を読み込むことができません。
```

原因は PowerShell が `npm.ps1` の実行を拒否するためです。次のどれかで対処してください。

- **対処 A: `npm.cmd` / `npx.cmd` を使う**（最も簡単・管理者権限不要）

    ```powershell
    npm.cmd install
    npx.cmd wrangler deploy
    ```

- **対処 B: 実行ポリシーを変更する**（管理者権限不要・推奨）

    ```powershell
    Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
    ```

    実行後、`Get-ExecutionPolicy` が `RemoteSigned` になれば `npm` がそのまま使えます。

- **対処 C: ターミナルを Command Prompt か Git Bash にする**

Git の改行コードは `.gitattributes` で **LF 固定**にしています。
`core.autocrlf` は設定不要です。変更しないでください。

## 4. よく使うコマンド

| コマンド                | 用途                                        | 実行タイミング     |
| ----------------------- | ------------------------------------------- | ------------------ |
| `npm install`           | 依存関係を取得                              | 初回・更新時       |
| `npm run dev`           | ローカルで動かす（`http://127.0.0.1:8787`） | 確認するとき       |
| `npm run db:local`      | ローカルの保存場所を作る                    | 初回・作り直すとき |
| `npm run db:local:seed` | 動作確認用の記事を入れる                    | 任意               |
| `npm run check:free`    | 料金が発生する設定が無いか確かめる          | デプロイ前         |
| `npm run format`        | HTML / CSS / JS / MD をまとめて整形         | 任意（通常は不要） |
| `npm run deploy`        | Cloudflare へ公開する                       | 運営だけ           |

整形と検査は**保存時に自動で走る**ので、コミット前にコマンドを実行する必要はありません。
`npm` が動かない場合は、上記の `npm` を `npm.cmd` に読み替えてください。

## 5. コミットして PR を出すまで

```bash
git add -A
git commit -m "feat(hero): Discord 招待ボタンを追加"
git push -u origin HEAD
```

- コミットメッセージの形式は [CODING_RULES.md](./CODING_RULES.md) の第 5 章を参照
- Pull Request は **`develop` 向け**に作成する（`main` へは向けない）

push してよいのは、レビューを頼むときだけです。相談前の作業は手元に置いておきます。

## 6. コラムを投稿する（Git を使わない人向け）

コラムは**サイトの中のフォーム**から投稿します。Git も GitHub も使いません。
アカウントも要りません。

1. `https://terraria-jp.terraria-jp-website.workers.dev/post` を開く
2. タイトルと本文を書く
3. 画像を入れたいときは「画像を追加」（1 枚 1MB まで）
4. 「投稿する」を押す

本文の書き方:

- 見出しは行のはじめに `## `、太字は `**太字**`、箇条書きは行のはじめに `- `
- 空の行をはさむと段落が変わります
- 右側の「下見」で、公開される見た目を確かめられます

送った内容は「承認待ち」になり、運営が確認してから一覧に並びます。
「ウェブサイト」という欄がありますが、これは機械をよけるためのものなので触らないでください。

### 公開のしくみ（運営向け）

- 投稿は Cloudflare D1 に「承認待ち」で保存される（デプロイは起きない）
- 運営が `/admin/columns` で読んで、公開・見送り・削除を決める
- 公開した瞬間からコラムの一覧に並ぶ
- 手順の詳細と、合言葉の設定は [CLOUDFLARE.md](./CLOUDFLARE.md) を参照

## 7. つまずいたとき

| 症状                                    | 原因と対処                                                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `npm` が動かない                        | PowerShell の実行ポリシー → 第 3 章                                                                               |
| 保存しても整形されない                  | VS Code の Prettier 拡張が入っているか確認する                                                                    |
| Stylelint の警告がエディタに出ない      | `npm install` をしたか確認（公式拡張は Stylelint を内蔵していない）                                               |
| Stylelint がクラス名を指摘する          | `l-` / `c-` / `p-` / `u-` の接頭辞を付ける → CODING_RULES.md 第 3 章                                              |
| `npm install` で `EBADENGINE` 警告      | Node.js が 20.19.0 未満。Node.js を更新する                                                                       |
| `npm install` で脆弱性の警告が出る      | 開発用ツール内の指摘で、公開サイトには影響しない。対応不要                                                        |
| `node_modules` が `git status` に出ない | 正常。`.gitignore` で除外済み                                                                                     |
| 日本語が文字化けする                    | ファイルが UTF-8 / LF になっているか確認する                                                                      |
| `public/index.html` を開いても動かない  | コラムは Worker が返している。`npm run dev` で確認する（第 2 章 手順 6）                                          |
| `npm run dev` が起動しない              | 別の `npm run dev` やプロセスが 8787 番ポートを使っていないか確認する                                             |
| `SQLITE_BUSY` が出る                    | `npm run dev` と `npm run db:local` を同時に動かさない                                                            |
| ローカルの記事が消えた                  | `database_id` を変えるとローカルの D1 は作り直される。`npm run db:local` と `npm run db:local:seed` を実行する    |
| 承認ページに入れない（ローカル）        | `.dev.vars` を作って `ADMIN_PASSWORD` を入れたか確認する                                                          |
| 承認ページに入れない（本番）            | 合言葉が未設定か、10 分間に 5 回間違えた。→ CLOUDFLARE.md 第 6 章                                                 |
| 直したのに公開サイトが変わらない        | コードは `npm run deploy` が要る。記事は D1 に入るのでデプロイ不要                                                |
| 共通ヘッダが表示されない                | `<script src="assets/js/components/site-header.js" defer>` を読み込んでいるか確認する → CODING_RULES.md 第 4.2 節 |

## 8. セットアップ完了チェック

- [ ] `git clone` してフォルダに入れた
- [ ] `npm install` を実行した
- [ ] VS Code の推奨拡張機能を入れた
- [ ] CSS を保存すると自動で整形される
- [ ] `npm run db:local` と `npm run dev` で `http://127.0.0.1:8787` が開けた
- [ ] `develop` から作業ブランチを切った
- [ ] [CODING_RULES.md](./CODING_RULES.md) を読んだ
