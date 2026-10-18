# 開発への参加手順 — 環境構築から最初の PR まで

新しく開発に参加する人向けの手順です。上から順に進めれば開発を始められます。
コーディングの書き方は [CODING_RULES.md](./CODING_RULES.md) を参照してください。

## 1. 必要なもの

| ツール   | バージョン       | 確認コマンド    | 備考                                 |
| -------- | ---------------- | --------------- | ------------------------------------ |
| Git      | 2.40 以上        | `git --version` | 確認済み環境: 2.53.0                 |
| Node.js  | **20.19.0 以上** | `node -v`       | 確認済み環境: v24.20.0。LTS 版を推奨 |
| VS Code  | 最新             | -               | 任意。推奨設定を同梱しているので推奨 |
| ブラウザ | 最新             | -               | Chrome / Edge / Firefox / Safari     |

Node.js の最低バージョンは同梱ツールの都合で決まっています（`stylelint@17` が `>=20.19.0` を要求）。
`package.json` の `engines` に記載済みなので、古い Node だと `npm install` 時に警告が出ます。

ビルドツールは不要です。Node.js は整形・検査ツールを動かすためだけに使います。

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

`package-lock.json` と完全に同じ状態にしたい場合は `npm ci` を使う（初回はどちらでも可）。

### 手順 4: 動作確認する

```bash
npm run lint
```

次のように表示されれば成功です。

```
All matched files use Prettier code style!
```

`stylelint` のエラーが 0 件なら OK（成功時は何も表示されません）。終了コードが `0` かどうかで判断できます。

### 手順 5: 推奨拡張機能を入れる（VS Code）

VS Code でこのフォルダを開くと、推奨拡張機能の通知が出ます。インストールしてください。

- Prettier（整形）
- Stylelint（CSS 検査）
- EditorConfig

同梱の `.vscode/settings.json` により、**保存時に自動で整形**されます。

### 手順 6: ページを表示して確認する

ビルドは不要です。`index.html` をブラウザで直接開いてください。
VS Code を使う場合は Live Server などの拡張機能で開いても構いません。

## 3. Windows を使っている人へ（重要）

PowerShell の実行ポリシーが `Restricted` の環境では、`npm` コマンドが次のエラーで失敗します。

```
npm : このシステムではスクリプトの実行が無効になっているため、
ファイル C:\Program Files\nodejs\npm.ps1 を読み込むことができません。
```

原因は PowerShell が `npm.ps1` の実行を拒否するためです。次のどれかで対処してください。

- **対処 A: `npm.cmd` を使う**（最も簡単・管理者権限不要）

    ```powershell
    npm.cmd install
    npm.cmd run lint
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

| コマンド               | 用途                           | 実行タイミング       |
| ---------------------- | ------------------------------ | -------------------- |
| `npm install`          | 依存関係を取得                 | 初回・更新時         |
| `npm run format`       | HTML / CSS / JS / MD を整形    | 手動で整えたいとき   |
| `npm run lint`         | 整形チェック + CSS 検査        | コミット前（必須）   |
| `npm run lint:css:fix` | CSS の自動修正できる指摘を直す | CSS で指摘が出たとき |

`npm` が動かない場合は、上記の `npm` を `npm.cmd` に読み替えてください。

## 5. コミットして PR を出すまで

```bash
git add -A
git commit -m "feat(hero): Discord 招待ボタンを追加"
git push -u origin HEAD
```

- コミットメッセージの形式は [CODING_RULES.md](./CODING_RULES.md) の第 5 章を参照
- Pull Request は **`develop` 向け**に作成する（`main` へは向けない）
- PR を出す前に `npm run lint` を通す

## 6. つまずいたとき

| 症状                                    | 原因と対処                                                           |
| --------------------------------------- | -------------------------------------------------------------------- |
| `npm` が動かない                        | PowerShell の実行ポリシー → 第 3 章                                  |
| `npm run lint` が整形エラーで落ちる     | `npm run format` を実行してから再実行                                |
| Stylelint がクラス名を指摘する          | `l-` / `c-` / `p-` / `u-` の接頭辞を付ける → CODING_RULES.md 第 3 章 |
| `npm install` で `EBADENGINE` 警告      | Node.js が 20.19.0 未満。Node.js を更新する                          |
| `npm install` で脆弱性の警告が出る      | 開発用ツール内の指摘で、公開サイトには影響しない。対応不要           |
| `node_modules` が `git status` に出ない | 正常。`.gitignore` で除外済み                                        |
| 日本語が文字化けする                    | ファイルが UTF-8 / LF になっているか確認する                         |

## 7. セットアップ完了チェック

- [ ] `git clone` してフォルダに入れた
- [ ] `npm install` が成功した
- [ ] `npm run lint` が終了コード 0 で通った
- [ ] VS Code の推奨拡張機能を入れた
- [ ] `index.html` がブラウザで表示された
- [ ] `develop` から作業ブランチを切った
- [ ] [CODING_RULES.md](./CODING_RULES.md) を読んだ
