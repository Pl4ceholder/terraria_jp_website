# コーディングルール — Terraria JP 公式サイト

このサイトのコードは、この文書のルールに沿って書く。
判断に迷ったら、まずこの文書を確認し、書かれていなければルールを追記してから書く。

初めて参加する場合の環境構築は [CONTRIBUTING.md](./CONTRIBUTING.md)、
公開のしくみと Cloudflare の操作は [CLOUDFLARE.md](./CLOUDFLARE.md) を参照。

## 0. 前提

| 項目           | 方針                                                                        |
| -------------- | --------------------------------------------------------------------------- |
| 構成           | 素の HTML / CSS / JavaScript。動く部分は Cloudflare Workers + D1（第 6 章） |
| フレームワーク | 使わない（React 等は導入しない）                                            |
| 対応ブラウザ   | 最新の Chrome / Edge / Firefox / Safari                                     |
| 対応画面       | モバイルファースト（スマホ優先、PC は広げる）                               |
| テーマ         | ダークテーマ固定（ライトテーマは作らない）                                  |
| 文字コード     | UTF-8（BOM 無し）                                                           |
| 改行コード     | LF                                                                          |
| インデント     | 半角スペース 4 つ                                                           |
| コメント言語   | 日本語                                                                      |
| 課金           | 無料枠（Workers と D1）だけで動かす。料金が発生する仕組みは入れない         |

外部ライブラリ（CDN 読み込みを含む）を足すときは、先に相談する。
今のところ承認済みなのは `marked`（Markdown → HTML）、`wrangler`（Cloudflare の操作）、
`prettier`（整形）、`stylelint`（CSS の検査）。閲覧者に配信されるのは `marked` の変換結果だけで、
ライブラリそのものは配信されない（変換はサーバー側で行う）。

料金が発生しうるサービス（R2・KV・Queues・Workers AI など）を足したくなったときも、先に相談する。
このサイトは「上限を超えたらエラーになるだけで、請求は来ない」無料枠だけで動かす。
入っていないことは `npm run check:free` で確かめられる（有料の設定が混ざっていれば失敗する）。

## 1. ディレクトリ構成

```
.
├─ public/                   そのまま配信されるページと素材（ここに入れたものだけが公開される）
│  ├─ index.html             トップページ
│  ├─ news.html              お知らせ
│  ├─ server.html            サーバー紹介
│  ├─ post.html              コラムの投稿フォーム
│  ├─ admin/
│  │  └─ columns.html        コラムの承認（運営用。noindex）
│  └─ assets/
│     ├─ css/
│     │  ├─ style.css        スタイルの入口（@import を並べるだけ）
│     │  ├─ common/          全ページ共通
│     │  │  ├─ variables.css  CSS 変数（色・余白・サイズ）
│     │  │  ├─ reset.css      ブラウザ既定スタイルのリセット
│     │  │  ├─ base.css       要素単位の基本スタイル
│     │  │  ├─ layout.css     l-（ヘッダー・フッター・コンテナ）
│     │  │  ├─ components.css c-（ボタンなど使い回す部品）
│     │  │  └─ utilities.css  u-（補助クラス）
│     │  └─ pages/           ページ固有
│     │     ├─ home.css      p-（トップページ）
│     │     ├─ news.css      p-（お知らせ）
│     │     ├─ server.css    p-（サーバー紹介）
│     │     ├─ columns.css   p-（コラムの一覧と記事）
│     │     ├─ post.css      p-（投稿フォーム）
│     │     ├─ recruit.css   p-（マルチ募集の一覧）
│     │     └─ admin.css     p-（承認）
│     ├─ js/
│     │  ├─ main.js          全ページ共通スクリプト
│     │  ├─ components/      共通パーツ（Web Component）
│     │  │  ├─ site-header.js 共通ヘッダの正本
│     │  │  └─ site-footer.js 共通フッターの正本
│     │  └─ pages/           そのページだけのスクリプト
│     │     ├─ post.js       投稿フォーム
│     │     ├─ news.js       お知らせ（これからのイベント）
│     │     └─ admin.js      承認
│     └─ img/                画像（命名は kebab-case、例: hero-bg.png）
├─ worker/                   動くページと API（Cloudflare Workers）
│  ├─ index.js               入口（振り分け・マイページ・実績の受け取り）
│  ├─ columns-api.js         コラムの表示・投稿・画像
│  ├─ recruit-api.js         募集の受け取りと一覧
│  ├─ events-api.js          イベントの受け取りと API
│  ├─ activities-api.js      活動の表示・投稿・取り下げ
│  ├─ admin-session.js       合言葉の出入りと「入っている証」
│  ├─ http.js                返事の形と、送られてきたものの読み取り
│  ├─ values.js              届いた値の整え方（長さ・数・日時）
│  ├─ sync.js                bot の合言葉の確かめ方
│  ├─ html.js                一覧・記事・404 の HTML
│  ├─ activity.js            活動ページの HTML
│  ├─ activities.js          活動の検証と SQL
│  ├─ achievements.js        実績の取り込みと SQL
│  ├─ requests.js            実績・称号の依頼
│  ├─ admin-achievements.js  実績の管理画面
│  ├─ admin-activities.js    活動の管理画面
│  ├─ admin-nav.js           管理画面の共通ナビ
│  ├─ auth.js                Discord ログイン
│  ├─ mypage.js              マイページの HTML
│  ├─ recruit.js             マルチ募集の HTML
│  ├─ recruitments.js        募集の選び方
│  ├─ events.js              イベントの選び方
│  ├─ markdown.js            Markdown → HTML
│  ├─ signing.js             クッキーの署名
│  ├─ schema.sql             保存場所の定義
│  └─ seed.sql               動作確認用の記事
├─ scripts/
│  └─ check-free-plan.mjs    料金が発生する設定が無いか確かめる
├─ dev/                      開発用（公開ページではない）
│  ├─ parts.html             共通パーツのプレビュー
│  └─ architecture.html      公開のしくみの図解
├─ CLOUDFLARE.md             公開のしくみと作業手順
├─ CODING_RULES.md           この文書
├─ package.json              npm スクリプト
└─ .vscode/                  VS Code 推奨設定
```

置き場所の判断基準:

- 全ページで使う見た目 → `public/assets/css/common/`
- 1 ページでしか使わない見た目 → `public/assets/css/pages/<ページ名>.css`
- 複数ページで使い回す部品（ボタンなど）→ `public/assets/css/common/components.css`
- 複数ページで使い回す HTML のまとまり（ヘッダーなど）→
  `public/assets/js/components/<名前>.js`（第 4.2 節）
- 1 ページだけの動き → `public/assets/js/pages/<ページ名>.js`（第 4.3 節）
  （`post.js` / `activity.js` / `news.js` / `admin.js`）
- 新しい CSS ファイルを足したら、必ず `style.css` に `@import` を追記する
- サーバー側の処理と API → `worker/`（入口は `index.js`、分野ごとに `*-api.js`。第 6 章）
- 保存場所（テーブル）を変える → `worker/schema.sql` に書き、ローカルと本番の両方に適用する
  （第 6 章）
- 運営だけが使うページ → `public/admin/` に置き、`<meta name="robots" content="noindex">` を付ける

## 2. HTML ルール

> 画面に出る文言（見出し・本文・ボタン・コメント）には作成者の意図がある。
> 誤字に見えても勝手に直さない。直す必要があるときは、先に確認する。

- 先頭に `<!DOCTYPE html>`、`<html lang="ja">`、`<meta charset="UTF-8">`、viewport を必ず書く。
- 構造は `header` / `main` / `section` / `footer` を使う。`div` は見た目のまとまりにだけ使う。
- インデントは半角スペース 4 つ。属性が多いときは 1 行 1 属性にする。
- タグは省略しない（`<li>` や `</p>` を省かない）。
- クラス名は CSS の命名規則（第 3 章）に合わせる。見た目のための命名はしない。
- id は CSS で使わない。スクリプトから触る目印には `data-*` を使う。
- リンクの文言だけで行き先が分かるようにする。「こちら」だけのリンクは禁止。
- 外部リンクは `target="_blank"` と `rel="noopener noreferrer"` を付ける。
- 画像には内容が分かる `alt` を書く。装飾目的の画像は `alt=""`。
- 補足は日本語コメントで残す。コメントは「なぜ」を書く。

## 3. CSS ルール（FLOCSS 寄せ + BEM）

### 3.1 レイヤーと接頭辞

クラスの役割は接頭辞で判断する。接頭辞が無いクラスは書かない。

| 接頭辞 | レイヤー  | 置き場所                | 例                    |
| ------ | --------- | ----------------------- | --------------------- |
| `l-`   | layout    | `common/layout.css`     | `l-header` `l-footer` |
| `c-`   | component | `common/components.css` | `c-button`            |
| `p-`   | project   | `pages/*.css`           | `p-hero`              |
| `u-`   | utility   | `common/utilities.css`  | `u-visually-hidden`   |

- foundation（`variables.css` / `reset.css` / `base.css`）は接頭辞を使わず、要素セレクタと変数だけを扱う。
- `p-` はそのページ専用。別ページで使いたくなったら `c-` に格上げする。

### 3.2 命名は BEM

```
block__element--modifier
```

- `block` … 独立した部品（例: `p-hero`）
- `__element` … block に属する要素（例: `p-hero__title`）
- `--modifier` … 見た目や状態のバリエーション（例: `c-button--large`）

例:

```css
.p-hero {
}
.p-hero__title {
}
.p-hero__title--small {
}
```

### 3.3 書き方

- 詳細度は基本的に `0,1,0`（クラス 1 つ）に保つ。
- ネストは使わない（素の CSS のため）。子孫セレクタも最小限にする。
- 要素セレクタとクラスの複合（`p.p-hero__lead` など）は書かない。
- クラス名だけで場所を特定できるようにし、`>` やスペースでの指定に頼らない。
- 例外: Markdown から作る記事の本文（`c-prose`）は、こちらでクラスを付けられない
  ので、そのブロックの中だけ子孫セレクタで要素（`h2` や `ul` など）に当てる。
- プロパティの並びは、レイアウト → 見た目 → 文字 → その他の順で書く。

### 3.4 変数（デザイントークン）

- 色・余白・角丸・影・フォントは `variables.css` の変数を使う。直書きは禁止。
- 例外: そのページで一度しか使わない配色などは、そのページの CSS にコメント付きで直接書いてよい。
- 変数を足すときは `--color-` `--space-` `--font-` `--radius-` のように用途が分かる名前を付ける。
- 同じ値が 2 回以上出てきたら変数化する。

### 3.5 単位と書式

- 文字サイズ・余白は `rem` を使う。`px` はボーダー幅など細かい値だけ。
- 画面幅に応じた可変は `clamp()` を使う。
- 色は小文字で統一（`#4caf50`、`rgb(0 0 0 / 35%)`）。
- `!important` は禁止。id セレクタも禁止。

## 4. JavaScript ルール

### 4.1 基本

- `var` は禁止。`const` を優先し、再代入が必要なときだけ `let`。
- 比較は `===` / `!==` を使う。
- グローバル変数を増やさない。`main.js` は関数の中か `DOMContentLoaded` の中に書く。
- 要素の取得は `data-*` 属性かクラスで行う。id で取得しない。
- 文字列はダブルクォート、文末はセミコロン（Prettier の既定に従う）。
- 追加のスクリプトは `<script src="..." defer></script>` で読み込む。
- 機能ごとに関数を分け、1 つの関数を長くしすぎない。

### 4.2 共通パーツ（Web Component）

ヘッダーなど複数ページで使い回す HTML は、カスタム要素 1 つにまとめて `assets/js/components/` に置く。
使う側のページには、次の 2 行だけを書く。

```html
<x-site-header></x-site-header>
<script src="assets/js/components/site-header.js" defer></script>
```

- `type="module"` は使わない。`file://` で開いたときに読み込まれなくなるため、通常の `<script defer>` にする。
- テンプレートは JS の中に持つ。外部の HTML を `fetch` すると `file://` で動かなくなる。
- 見た目は CSS 側（`common/`）に書く。Shadow DOM は使わない（クラスで指定できるようにするため）。
- カスタム要素の名前はハイフンを 1 つ以上含め、`x-` で始める（例: `x-site-header`）。
- 初期化済みかどうかを `data-*` で持ち、同じ要素が再接続されても二重に組み立てない。
- ヘッダーのナビ項目は `site-header.js` の `NAV_ITEMS` で管理する。ページを足したらここを直す。
  項目に `match` を書くと、そのページでは「現在地」として扱う（`columns/xxx.html` のように、
  href とページ名が一致しない下の階層をまとめて指したいときに使う）。
- フッターの SNS リンクは `site-footer.js` の `SOCIAL_LINKS` で管理する。
  外部 URL は `http` から始まる文字列にすれば、`target="_blank"` と `rel="noopener noreferrer"` が自動で付く。
- アイコンだけのリンクには `aria-label` で名前を付ける（アイコンの SVG は `aria-hidden="true"` にする）。
- 下の階層のページ（`columns/xxx.html` など）でもリンクがずれないよう、サイトのルートは
  スクリプト自身の URL から求める。値は `SiteHeader.root` / `SiteFooter.root` に持ち、
  トップレベルの `const` には置かない（下の注意を参照）。
- 通常の `<script>` は**グローバルを共有する**。同じ名前のトップレベル `const` を別の
  コンポーネントで宣言すると、後から読み込んだ方が
  `SyntaxError: Identifier '...' has already been declared` で止まり、そのパーツが丸ごと
  表示されなくなる。名前はコンポーネントごとに変えるか、クラスの中に閉じ込める。
- 新しい共通パーツは `dev/parts.html` に並べて確認する。

### 4.3 ページ固有のスクリプト

そのページだけの動きは `public/assets/js/pages/<ページ名>.js` に置く（`post.js` / `activity.js` / `admin.js`）。
読み込みは共通パーツと同じく `<script src="..." defer></script>` で行う。

- ページ側は `data-*` で目印を付け、スクリプトは `document.querySelector("[data-...]")` で拾う
- サーバーとのやり取りは `fetch`。返ってくる JSON は `{ ok: true, ... }` か
  `{ ok: false, message: "..." }` の形に揃え、`message` はそのまま画面に出す
  （文言はサーバー側に寄せると、直す場所が 1 か所で済む）
- 入力の上限はサーバー側（コラムは `worker/columns-api.js` の `LIMITS`）と揃える。画面側だけで止めない
- 送信中はボタンを `disabled` にして、二重送信を防ぐ
- 画面の切り替え（ログイン前 / ログイン後など）は `hidden` の付け外しで行い、見た目は CSS で変える

## 5. Git / コミット

- コミットメッセージは Conventional Commits 風に書く。本文と補足は日本語でよい。

```
<type>(<scope>): <概要>
```

| type       | 使うとき                           |
| ---------- | ---------------------------------- |
| `feat`     | 新しい機能・ページ・セクション     |
| `fix`      | 不具合の修正                       |
| `style`    | 見た目だけの変更（挙動を変えない） |
| `refactor` | 挙動を変えないコード整理           |
| `docs`     | ドキュメントのみ                   |
| `chore`    | 設定・依存関係・雑務               |
| `perf`     | 性能の改善                         |

例:

```
feat(hero): Discord 招待ボタンを追加
fix(css): スマホでヒーローが横スクロールする問題を修正
chore: Prettier と Stylelint を導入
```

- 1 コミット 1 目的にする。関係ない整形と機能追加は混ぜない。
- `main` で作業する場合も、まとまった単位でコミットする。

## 6. ツールと使い方

導入済み: Prettier（整形）、Stylelint（CSS の検査）、EditorConfig、Wrangler（Cloudflare の操作）。

整形と検査は**エディタで保存したとき**に自動で走る（`.vscode/settings.json` で設定済み）。
コミット前にコマンドを実行する必要はない。

| コマンド                | 用途                                        |
| ----------------------- | ------------------------------------------- |
| `npm run dev`           | ローカルで動かす（`http://127.0.0.1:8787`） |
| `npm run db:local`      | ローカルの保存場所を作る                    |
| `npm run db:local:seed` | 動作確認用の記事を入れる                    |
| `npm run check:free`    | 料金が発生する設定が無いか確かめる          |
| `npm run format`        | まとめて整形したいとき（任意）              |
| `npm run deploy`        | Cloudflare へ公開する（運営だけ）           |

- 保存時の整形（Prettier）は VS Code 拡張に内蔵の Prettier でも動くため、npm が無くても使える。
- Stylelint をエディタで動かすには `npm install` が必要（公式拡張は Stylelint を内蔵していない）。
- 拡張機能は `.vscode/extensions.json` の推奨を入れる。
- `node_modules/` はコミットしない（`.gitignore` 済み）。

### 保存場所（D1）と Worker

動く部分は `worker/` に置く。保存場所は Cloudflare D1 で、記事も画像もそこに入る。

- 振り分けは `worker/index.js`。API は分野ごとに `worker/columns-api.js`（コラム・画像）、
  `worker/recruit-api.js`、`worker/events-api.js`、`worker/activities-api.js` に分ける
- 返事の形と入力の読み取りは `worker/http.js`、合言葉の出入りは `worker/admin-session.js`、
  届いた値の整え方は `worker/values.js` に置く（同じ道具を書き写さない）
- コラムの一覧・記事の HTML は `worker/html.js`、マルチ募集の HTML は `worker/recruit.js`、
  Markdown の変換は `worker/markdown.js`
- Discord の内容をサイトに出すときは、サイトから Discord を叩かず、bot から
  `POST /api/internal/...` で受け取って D1 に入れる。合言葉は `SYNC_SECRET`（合言葉が
  無ければ 503、違えば 401）。受け取った内容で丸ごと入れ替え、何度届いても同じ結果にする
- その内容を見せるときは、ページ側（`pages/*.js`）が `GET /api/...` を読んで画面を作る。
  1 件も無いとき・取れなかったときは、かたまりごと出さない
- 保存場所（テーブル）は `worker/schema.sql` に書く。何度実行しても同じ結果になるように書く
- スキーマを変えたら、ローカル（`npm run db:local`）と本番（`npm run db:remote`）の両方に適用する
- 本番のデータを直接変える作業は、先に相談する
- アップロードできる画像は 1 枚 1MB・合計 400MB まで（無料枠の手前で断るため）
- 上限の値（`LIMITS` など）はアプリ側にまとめ、画面側（`post.js`）と揃える
- Markdown の変換には `marked` を使う（サーバー側だけで動く。閲覧者には配信されない）
- 生の HTML は文字として出す。コメント（`<!-- -->`）だけは目印としてそのまま残す

**料金**: 使うのは Workers と D1 だけ。無料枠を超えるとエラーになるだけで、請求は来ない。
使った分だけ請求が来るサービス（R2・KV・Queues など）は使わない。混ざっていないかは
`npm run check:free` で確かめる。詳しくは [README.md](./README.md) と
[CLOUDFLARE.md](./CLOUDFLARE.md) を参照。

## 7. 提出前チェックリスト

- [ ] 保存時に自動整形・検査が効いている（余計な空白や書き方の警告が残っていない）
- [ ] スマホ幅（375px 程度）で崩れない
- [ ] キーボード操作と色のコントラストを確認した
- [ ] クラス名が `l-` / `c-` / `p-` / `u-` のいずれかで始まっている
- [ ] 共通パーツを変えたら `dev/parts.html` で表示を確認した
- [ ] 色・余白が `variables.css` の変数になっている
- [ ] 画像の `alt`、外部リンクの `rel` を確認した
- [ ] `npm run check:free` が通る（料金が発生する設定が入っていない）
- [ ] 動くページを変えたときは `npm run dev` で表示を確認した
- [ ] Discord 連携まわりを変えたときは `check:events` / `check:recruit` / `check:achievements` /
      `check:requests` / `check:mypage` が通る
- [ ] コミットメッセージが `<type>(<scope>): <概要>` の形になっている
