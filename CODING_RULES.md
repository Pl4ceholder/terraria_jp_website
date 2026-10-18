# コーディングルール — Terraria JP 公式サイト

このサイトのコードは、この文書のルールに沿って書く。
判断に迷ったら、まずこの文書を確認し、書かれていなければルールを追記してから書く。

初めて参加する場合の環境構築は [CONTRIBUTING.md](./CONTRIBUTING.md) を参照。

## 0. 前提

| 項目           | 方針                                                   |
| -------------- | ------------------------------------------------------ |
| 構成           | ビルド無しの静的サイト（素の HTML / CSS / JavaScript） |
| フレームワーク | 使わない（React 等は導入しない）                       |
| 対応ブラウザ   | 最新の Chrome / Edge / Firefox / Safari                |
| 対応画面       | モバイルファースト（スマホ優先、PC は広げる）          |
| テーマ         | ダークテーマ固定（ライトテーマは作らない）             |
| 文字コード     | UTF-8（BOM 無し）                                      |
| 改行コード     | LF                                                     |
| インデント     | 半角スペース 4 つ                                      |
| コメント言語   | 日本語                                                 |

外部ライブラリ（CDN 読み込みを含む）を足すときは、先に相談する。

## 1. ディレクトリ構成

```
.
├─ index.html                トップページ
├─ CODING_RULES.md           この文書
├─ package.json              npm スクリプト
├─ assets/
│  ├─ css/
│  │  ├─ style.css           スタイルの入口（@import を並べるだけ）
│  │  ├─ common/             全ページ共通
│  │  │  ├─ variables.css    CSS 変数（色・余白・サイズ）
│  │  │  ├─ reset.css        ブラウザ既定スタイルのリセット
│  │  │  ├─ base.css         要素単位の基本スタイル
│  │  │  ├─ layout.css       l-（ヘッダー・フッター・コンテナ）
│  │  │  └─ components.css   c-（ボタンなど使い回す部品）
│  │  └─ pages/              ページ固有
│  │     └─ home.css         p-（トップページ）
│  ├─ js/
│  │  ├─ main.js             全ページ共通スクリプト
│  │  └─ components/         共通パーツ（Web Component）
│  │     ├─ site-header.js   共通ヘッダの正本
│  │     └─ site-footer.js   共通フッターの正本
│  └─ img/                   画像（命名は kebab-case、例: hero-bg.png）
├─ dev/                      開発用（公開ページではない）
│  └─ parts.html             共通パーツのプレビュー
└─ .vscode/                  VS Code 推奨設定
```

置き場所の判断基準:

- 全ページで使う見た目 → `assets/css/common/`
- 1 ページでしか使わない見た目 → `assets/css/pages/<ページ名>.css`
- 複数ページで使い回す部品（ボタンなど）→ `assets/css/common/components.css`
- 複数ページで使い回す HTML のまとまり（ヘッダーなど）→ `assets/js/components/<名前>.js`（第 4.1 節）
- 新しい CSS ファイルを足したら、必ず `style.css` に `@import` を追記する

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

| 接頭辞 | レイヤー  | 置き場所                   | 例                    |
| ------ | --------- | -------------------------- | --------------------- |
| `l-`   | layout    | `common/layout.css`        | `l-header` `l-footer` |
| `c-`   | component | `common/components.css`    | `c-button`            |
| `p-`   | project   | `pages/*.css`              | `p-hero`              |
| `u-`   | utility   | 必要になったら追加（保留） | `u-visually-hidden`   |

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
- フッターの SNS リンクは `site-footer.js` の `SOCIAL_LINKS` で管理する。
  外部 URL は `http` から始まる文字列にすれば、`target="_blank"` と `rel="noopener noreferrer"` が自動で付く。
- アイコンだけのリンクには `aria-label` で名前を付ける（アイコンの SVG は `aria-hidden="true"` にする）。
- 新しい共通パーツは `dev/parts.html` に並べて確認する。

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

導入済み: Prettier（整形）、Stylelint（CSS の検査）、EditorConfig。

整形と検査は**エディタで保存したとき**に自動で走る（`.vscode/settings.json` で設定済み）。
コミット前にコマンドを実行する必要はない。

```bash
npm install     # 任意（初回のみ）。Stylelint をエディタで動かす場合は必要
npm run format  # まとめて整形したいとき（任意）
```

- 保存時の整形（Prettier）は VS Code 拡張に内蔵の Prettier でも動くため、npm が無くても使える。
- Stylelint をエディタで動かすには `npm install` が必要（公式拡張は Stylelint を内蔵していない）。
- 拡張機能は `.vscode/extensions.json` の推奨を入れる。
- `node_modules/` はコミットしない（`.gitignore` 済み）。

## 7. 提出前チェックリスト

- [ ] 保存時に自動整形・検査が効いている（余計な空白や書き方の警告が残っていない）
- [ ] スマホ幅（375px 程度）で崩れない
- [ ] キーボード操作と色のコントラストを確認した
- [ ] クラス名が `l-` / `c-` / `p-` / `u-` のいずれかで始まっている
- [ ] 共通パーツを変えたら `dev/parts.html` で表示を確認した
- [ ] 色・余白が `variables.css` の変数になっている
- [ ] 画像の `alt`、外部リンクの `rel` を確認した
- [ ] コミットメッセージが `<type>(<scope>): <概要>` の形になっている
