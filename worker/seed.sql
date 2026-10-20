-- ==========================================================================
-- seed.sql — 動作確認用のコラム（仮テキスト）
--
-- 使い方:
--     npm run db:local          （先に表を作る）
--     npm run db:local:seed     （この中身を入れる）
--
-- 本番で使うとき:
--     npx wrangler d1 execute terraria-jp --remote --file=worker/seed.sql
--
-- 中身は仮テキスト。消すときは記事ごと削除する（DELETE FROM columns;）。
-- ==========================================================================

INSERT OR IGNORE INTO columns
    (id, slug, title, body_md, body_html, author, tags, status, created_at, published_at, ip_hash)
VALUES
    ('2026-09-20-boss-sen-no-junbi', '2026-09-20-boss-sen-no-junbi', 'ボス戦の前に揃えたい装備', '<!-- 仮テキスト。実際の記事に差し替える -->

ボスごとに必要なものは変わりますが、共通してあると安心なものを挙げます。

| 準備するもの     | 理由                     |
| ---------------- | ------------------------ |
| 回復ポーション   | 立て直す余裕が生まれる   |
| 足場             | 縦の動きを確保できる     |
| 松明             | 暗いと避けられない       |

とくに**足場**は後回しにされがちですが、あるだけで難しさが変わります。', '<!-- 仮テキスト。実際の記事に差し替える -->
<p>ボスごとに必要なものは変わりますが、共通してあると安心なものを挙げます。</p>
<table>
<thead>
<tr>
<th>準備するもの</th>
<th>理由</th>
</tr>
</thead>
<tbody><tr>
<td>回復ポーション</td>
<td>立て直す余裕が生まれる</td>
</tr>
<tr>
<td>足場</td>
<td>縦の動きを確保できる</td>
</tr>
<tr>
<td>松明</td>
<td>暗いと避けられない</td>
</tr>
</tbody></table>
<p>とくに<strong>足場</strong>は後回しにされがちですが、あるだけで難しさが変わります。</p>
', 'たけのこ', 'ボス, 装備', 'published', '2026-09-20T00:00:00.000Z', '2026-09-20T00:00:00.000Z', '');

INSERT OR IGNORE INTO columns
    (id, slug, title, body_md, body_html, author, tags, status, created_at, published_at, ip_hash)
VALUES
    ('2026-09-28-kenchiku-wo-hajimeru-mae-ni', '2026-09-28-kenchiku-wo-hajimeru-mae-ni', '建築をはじめる前に知っておきたいこと', '<!-- 仮テキスト。実際の記事に差し替える。書いた人とタグは省略できる -->

家は「機能」と「見た目」を分けて考えると作りやすくなります。

## 機能で決めること

- NPC の部屋の数と位置
- クラフト台の置き場所
- 移動の動線

## 見た目で決めること

- 使う素材（レンガ / 木材 / 石）
- 屋根の形

### 迷ったときは

小さく作って、あとから足すほうが失敗しにくいです。

---

素材を 2 種類以上混ぜると、同じ形でも印象が変わります。', '<!-- 仮テキスト。実際の記事に差し替える。書いた人とタグは省略できる -->
<p>家は「機能」と「見た目」を分けて考えると作りやすくなります。</p>
<h2>機能で決めること</h2>
<ul>
<li>NPC の部屋の数と位置</li>
<li>クラフト台の置き場所</li>
<li>移動の動線</li>
</ul>
<h2>見た目で決めること</h2>
<ul>
<li>使う素材（レンガ / 木材 / 石）</li>
<li>屋根の形</li>
</ul>
<h3>迷ったときは</h3>
<p>小さく作って、あとから足すほうが失敗しにくいです。</p>
<hr>
<p>素材を 2 種類以上混ぜると、同じ形でも印象が変わります。</p>
', '', '', 'published', '2026-09-28T00:00:00.000Z', '2026-09-28T00:00:00.000Z', '');

INSERT OR IGNORE INTO columns
    (id, slug, title, body_md, body_html, author, tags, status, created_at, published_at, ip_hash)
VALUES
    ('2026-10-05-shoshinsha-ga-saisho-ni-yaru-koto', '2026-10-05-shoshinsha-ga-saisho-ni-yaru-koto', '初心者が最初にやること', '<!-- 仮テキスト。実際の記事に差し替える -->

最初の 1 時間でやっておくと、そのあとが楽になることをまとめます。

1. 木を切って作業台を作る
2. 家を 1 つ建てる（NPC が来る広さを確保する）
3. 地下に潜って鉱石を集める
4. ライフクリスタルを探す

## 装備の目安

最初は `木の剣` から `銅の剣` の順で十分です。**無理に強い敵を追いかけない**こと。', '<!-- 仮テキスト。実際の記事に差し替える -->
<p>最初の 1 時間でやっておくと、そのあとが楽になることをまとめます。</p>
<ol>
<li>木を切って作業台を作る</li>
<li>家を 1 つ建てる（NPC が来る広さを確保する）</li>
<li>地下に潜って鉱石を集める</li>
<li>ライフクリスタルを探す</li>
</ol>
<h2>装備の目安</h2>
<p>最初は <code>木の剣</code> から <code>銅の剣</code> の順で十分です。<strong>無理に強い敵を追いかけない</strong>こと。</p>
', 'さくら', '初心者, 進め方', 'published', '2026-10-05T00:00:00.000Z', '2026-10-05T00:00:00.000Z', '');

INSERT OR IGNORE INTO columns
    (id, slug, title, body_md, body_html, author, tags, status, created_at, published_at, ip_hash)
VALUES
    ('2026-10-12-hardcore-de-shinanai-tameni', '2026-10-12-hardcore-de-shinanai-tameni', 'ハードコアで死なないために', '<!-- 仮テキスト。実際の記事に差し替える -->

ハードコアは 1 回死んだら終わりです。だからこそ、準備の仕方がいつもと変わります。

## まず落とし穴を埋める

- 家のまわりを掘りすぎない
- 松明は多めに持つ
- 帰り道を先に作る

> 焦って前に進むより、戻れる道を残しておくほうが結局は速いです。

**石**を 1 スタック持っておくと、緊急の壁づくりにも使えます。', '<!-- 仮テキスト。実際の記事に差し替える -->
<p>ハードコアは 1 回死んだら終わりです。だからこそ、準備の仕方がいつもと変わります。</p>
<h2>まず落とし穴を埋める</h2>
<ul>
<li>家のまわりを掘りすぎない</li>
<li>松明は多めに持つ</li>
<li>帰り道を先に作る</li>
</ul>
<blockquote>
<p>焦って前に進むより、戻れる道を残しておくほうが結局は速いです。</p>
</blockquote>
<p><strong>石</strong>を 1 スタック持っておくと、緊急の壁づくりにも使えます。</p>
', 'ぷれいす', 'ハードコア, 初心者', 'published', '2026-10-12T00:00:00.000Z', '2026-10-12T00:00:00.000Z', '');

INSERT OR IGNORE INTO columns
    (id, slug, title, body_md, body_html, author, tags, status, created_at, published_at, ip_hash)
VALUES
    ('2026-10-19-hajimete-no-hardcore', '2026-10-19-hajimete-no-hardcore', 'コラムを始めました', '<!-- 仮テキスト。Terraria のコラムをここに載せていく -->

Terraria JP のコラムの 1 本目です。ここに本文が入ります。

## 見出しの例

本文は Markdown で書けます。ここは仮テキストです。

- 箇条書きはこのように書きます
- もう 1 行

**太字**や*斜体*、[リンク](https://example.com)も使えます。', '<!-- 仮テキスト。Terraria のコラムをここに載せていく -->
<p>Terraria JP のコラムの 1 本目です。ここに本文が入ります。</p>
<h2>見出しの例</h2>
<p>本文は Markdown で書けます。ここは仮テキストです。</p>
<ul>
<li>箇条書きはこのように書きます</li>
<li>もう 1 行</li>
</ul>
<p><strong>太字</strong>や<em>斜体</em>、<a href="https://example.com">リンク</a>も使えます。</p>
', 'Terraria JP 運営', 'はじめに', 'published', '2026-10-19T00:00:00.000Z', '2026-10-19T00:00:00.000Z', '');
