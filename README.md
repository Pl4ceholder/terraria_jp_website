# Terraria JP 公式サイト

Terraria の日本コミュニティ向けの公式サイトです。

## 概要

- 素の HTML / CSS / JavaScript による静的サイト（ビルド無し・フレームワーク無し）
- ページは `index.html` をブラウザで開けば確認できる
- 整形・検査はエディタの保存時に自動で走る（コミット前のチェックは無し）
- Node.js（20.19.0 以上）は Stylelint をエディタで動かすときだけ必要

## ドキュメント

| 文書                                 | 内容                                         |
| ------------------------------------ | -------------------------------------------- |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | 環境構築と開発の進め方。**最初にこれを読む** |
| [CODING_RULES.md](./CODING_RULES.md) | コーディング規約（HTML / CSS / JS / Git）    |

## はじめかた

```bash
npm install
```

整形（Prettier）は VS Code 拡張だけで動くため npm は必須ではありません。
CSS のクラス名チェック（Stylelint）をエディタで効かせるために `npm install` します。
手順の詳細は [CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください。

## ディレクトリ構成

```
index.html                トップページ
news.html                 お知らせ
server.html               サーバー紹介
assets/
├─ css/
│  ├─ style.css           スタイルの入口（@import を並べる）
│  ├─ common/             全ページ共通（変数・リセット・レイアウト・部品）
│  └─ pages/              ページ固有
├─ js/
│  ├─ main.js             全ページ共通スクリプト
│  └─ components/         共通パーツ（Web Component）
└─ img/                   画像
dev/parts.html            共通パーツのプレビュー（開発用）
```

## ブランチ構成

| ブランチ                      | 役割                                   |
| ----------------------------- | -------------------------------------- |
| `main`                        | 公開用。直接コミットしない             |
| `develop`                     | 開発の統合先。`feature` はここに集める |
| `feature/#<issue番号>_<内容>` | 作業用。1 つの issue につき 1 つ作る   |

作業は `feature` ブランチで行い、Pull Request は `develop` 向けに作成します。
