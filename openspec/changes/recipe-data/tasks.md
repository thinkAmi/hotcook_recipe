## 1. リポジトリ骨格

- [ ] 1.1 `package.json` を作成する（`type: module`、`engines.node` を mise の版に合わせる、`build` / `test` / `test:watch` / `test:coverage` / `lint` / `lint:fix` / `format` / `format:check` スクリプト）〔D-11〕
- [ ] 1.2 `.npmrc` に `min-release-age=7` を置く〔D-12〕
- [ ] 1.3 プロダクション依存として `js-yaml` と `markdown-it` を厳密な版で追加する〔D-02, D-03〕
- [ ] 1.4 開発依存として `vitest`・`fast-check`・`oxlint`・`oxfmt` を追加し、`package-lock.json` をコミット対象にする〔D-10, D-12〕
- [ ] 1.5 `.oxlintrc.json`（`correctness` を error、`public/` の生成物と `tests/fixtures/` を除外）と `.oxfmtrc.json`（Markdown・JSON・fixtures を除外）を置く〔D-12〕
- [ ] 1.6 `vitest.config` を置く（対象は `tests/**/*.test.*`）〔D-10〕
- [ ] 1.7 `.gitignore` に `node_modules/` と検索インデックスの生成物パスを追加する〔search-index: 生成物のコミット方針, D-09〕
- [ ] 1.8 `recipes/` `public/` `scripts/` `tests/fixtures/` を作る〔D-11〕

## 2. frontmatter スプリッタ

- [ ] 2.1 「先頭の `---` ブロックだけを frontmatter とし、js-yaml の `load` に委ねる」純関数を `scripts/` に実装する（BOM・CRLF 正規化、空 frontmatter は空オブジェクト、閉じ忘れ・キー値でない形はエラー）〔recipe-authoring: 1レシピ＝1 Markdown ファイル / frontmatter の項目, D-02〕
- [ ] 2.2 スプリッタの単体テストを書く：正常系、frontmatter 無し、閉じ忘れ、本文中の水平線、空 frontmatter、YAML 破損、リスト形の frontmatter、CRLF/BOM〔recipe-authoring の各エラーシナリオ, D-10〕
- [ ] 2.3 スプリッタのプロパティベーステストを書く。性質: 任意の frontmatter オブジェクト（文字列・文字列リスト）と任意の本文（`---` 行を含みうる）を YAML 化して結合 → 分割すると、元のオブジェクトと本文に戻る（往復性）〔D-10 (a)〕

## 3. ビルド（検証・変換・出力）

- [ ] 3.1 入力ディレクトリと出力先を引数で差し替えられるビルド関数を実装する（列挙 → 解析 → 検証 → 変換 → 並び替え → 出力）〔search-index: 全レシピを1つの JSON に集約する, D-01, D-10〕
- [ ] 3.2 検証を実装する：`title` 必須、`ingredients` は1件以上のリスト（空要素・前後空白除去後）、不備はファイル名と理由を積み、1件でもあれば出力せず失敗する〔recipe-authoring: frontmatter の項目, search-index: いずれかのレシピに不備がある, D-04〕
- [ ] 3.3 レシピオブジェクトへの正規化を実装する：8キー固定、任意項目は空文字、`menu_no` は文字列化、未知のキーは捨てる〔search-index: レシピオブジェクトの形, recipe-authoring: 機種は記録しない, D-06〕
- [ ] 3.4 本文の変換を実装する：`body` はソースそのまま（前後空白除去）、`body_html` は markdown-it（`html: false`、`breaks: true`、linkify なし）で生成〔search-index: 本文はプレーンと HTML の2表現を持つ, D-03, D-08〕
- [ ] 3.5 `title` の日本語ロケール昇順で並べ、整形した JSON を公開ディレクトリに書き出す。レシピ0件は失敗させる〔search-index: 料理名順に並ぶ / レシピが1件も無い, D-07〕
- [ ] 3.6 CLI エントリ（`npm run build`）を用意し、成功時は件数、失敗時は不備一覧を出して非ゼロ終了する〔D-04, D-11〕

## 4. ビルドのテスト

- [ ] 4.1 `tests/fixtures/` を用意する（正常3件／title 欠落／ingredients 空／ingredients が文字列／YAML 破損／0件／任意項目なし／生 HTML 入り本文）〔D-10〕
- [ ] 4.2 正常系テスト：要素数、8キーの存在、任意項目の空文字、`menu_no` の先頭ゼロ、材料の空白除去、並び順、2回ビルドの同一性〔search-index の各シナリオ〕
- [ ] 4.3 異常系テスト：各不備で失敗すること、失敗時に出力ファイルが書かれない（既存が上書きされない）こと、複数の不備が一覧で報告されること〔recipe-authoring の各エラーシナリオ, D-04〕
- [ ] 4.4 `body_html` に見出し・順序付きリストが含まれ、`<script>` がエスケープされることのテスト〔search-index: 本文はプレーンと HTML の2表現を持つ〕
- [ ] 4.5 正規化のプロパティベーステストを書く。性質: 任意の有効な frontmatter（title 非空、ingredients 1件以上、任意項目は有無ランダム）から得た出力は必ず8キーを持ち、任意項目は文字列、`ingredients` に空要素が無く、配列は料理名順で、2回ビルドで同一〔search-index: レシピオブジェクトの形 / 料理名順に並ぶ, D-10 (b)〕
- [ ] 4.6 レンダラ契約のプロパティベーステストを書く。性質: 任意の文字列を本文にしても `body_html` に生の `<script` が現れず、変換が例外を投げない〔search-index: 本文はプレーンと HTML の2表現を持つ, D-03, D-10 (c)〕

## 5. 初期データと README

- [ ] 5.1 サンプルレシピを 2〜3 件 `recipes/` に置く（自動調理キー＋番号のもの、手動設定のみのもの、を含める）〔recipe-authoring: 調理方法の項目は排他ではない〕
- [ ] 5.2 README を書く：レシピの書き方（frontmatter 例。`menu_no` は引用符で囲む）、ファイル名＝ID の規約、npm scripts 一覧、現在の機種名を記す1行（プレースホルダ）〔recipe-authoring: 機種は記録しない, D-05, D-11〕
- [ ] 5.3 クリーンな作業ツリーで `npm run build` `npm test` `npm run lint` `npm run format:check` が通り、生成物が未追跡として現れないことを確認する〔search-index: 生成物のコミット方針, D-12〕
