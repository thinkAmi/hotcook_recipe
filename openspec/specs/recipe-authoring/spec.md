## Purpose
著者がホットクックの自作レシピを書くための Markdown ファイル形式を定める。1レシピ＝1ファイルで、frontmatter に料理名・材料・調理方法を、本文に手順やメモを書く。ここで定めた形式が、検索用データを生成する唯一の入力になる。

## Requirements

### Requirement: 1レシピ＝1 Markdown ファイル
レシピは、リポジトリ内のレシピ置き場に置かれた Markdown ファイル1つで表されなければならない（SHALL）。ファイル名（拡張子を除く）はそのレシピの ID となり、著者が手動でローマ字のスラッグとして付ける。ファイルは、先頭の frontmatter ブロックと、それに続く本文からなる。

#### Scenario: レシピを追加する
- **WHEN** 著者がレシピ置き場に `butabara-daikon.md` のようなファイルを frontmatter 付きで作成する
- **THEN** ビルドはそのファイルを1件のレシピとして扱い、ID は `butabara-daikon` になる

#### Scenario: frontmatter が無い
- **WHEN** ファイルの先頭が frontmatter の区切りで始まっていない
- **THEN** ビルドは失敗し、そのファイル名と「frontmatter が無い」旨を報告する

#### Scenario: frontmatter が閉じていない
- **WHEN** frontmatter の開始区切りはあるが、対応する終了区切りが無い
- **THEN** ビルドは失敗し、そのファイル名と理由を報告する

#### Scenario: 本文中の水平線は frontmatter の終端と誤認しない
- **WHEN** frontmatter が正しく閉じたあと、本文中に Markdown の水平線（`---`）が現れる
- **THEN** ビルドは frontmatter を先頭ブロックのみとして扱い、本文の水平線をそのまま本文の一部として残す

### Requirement: frontmatter の項目
frontmatter は「キー: 値」の形式で、次の項目を持たなければならない（SHALL）。

| キー | 意味 | 必須 | 値の形 |
|---|---|---|---|
| `title` | 料理名 | 必須 | 空でない文字列 |
| `ingredients` | 材料 | 必須 | 1件以上の文字列のリスト。各要素は「豚バラ肉 200g」のように量・単位を分けない1行 |
| `auto_key` | 自動調理キー | 任意 | 文字列 |
| `menu_no` | 自動メニュー番号 | 任意 | 文字列（例: `"048"`。先頭のゼロを保つため引用符で囲む） |
| `manual_note` | 手動設定 | 任意 | 文字列 |

任意項目は、無い・空文字・値あり のいずれでもよい。上記以外のキーがあってもビルドは失敗しないが、検索用データには含めない。

#### Scenario: 必須項目が揃っている
- **WHEN** `title` が空でなく、`ingredients` に1件以上の要素がある
- **THEN** そのレシピはビルドを通過する

#### Scenario: title が無い、または空
- **WHEN** `title` キーが無い、または値が空文字・空白のみ
- **THEN** ビルドは失敗し、そのファイル名と「料理名が必要」である旨を報告する

#### Scenario: ingredients が無い、または空
- **WHEN** `ingredients` キーが無い、リストが空、または要素がすべて空文字・空白のみ
- **THEN** ビルドは失敗し、そのファイル名と「材料を1件以上書く」旨を報告する

#### Scenario: ingredients がリストでない
- **WHEN** `ingredients` の値が文字列1つなど、リスト以外の形で書かれている
- **THEN** ビルドは失敗し、そのファイル名と理由を報告する

#### Scenario: YAML として壊れている
- **WHEN** frontmatter の中身が YAML として解析できない
- **THEN** ビルドは失敗し、そのファイル名と解析エラーの内容を報告する

#### Scenario: frontmatter が「キー: 値」の形でない
- **WHEN** frontmatter の中身がリストや単一の値など、キーと値の組でない
- **THEN** ビルドは失敗し、そのファイル名と理由を報告する

### Requirement: 調理方法の項目は排他ではない
`auto_key`・`menu_no`・`manual_note` は互いに独立した任意項目であり、ビルドはどの組み合わせも許容しなければならない（SHALL）。組み合わせの検証は行わない。

#### Scenario: 自動調理キーと手動設定を両方書く
- **WHEN** `auto_key` と `manual_note` の両方に値がある
- **THEN** ビルドはそのまま通過し、両方を検索用データに含める

#### Scenario: 調理方法を何も書かない
- **WHEN** `auto_key`・`menu_no`・`manual_note` がいずれも無い、または空
- **THEN** ビルドはそのまま通過する

#### Scenario: 番号だけ書く
- **WHEN** `menu_no` に値があり `auto_key` が無い
- **THEN** ビルドはそのまま通過する

### Requirement: 機種は記録しない
レシピの frontmatter に機種を表す項目を設けてはならない（SHALL NOT）。自動メニュー番号は「利用者が現在使っている1台の機種」を暗黙の基準とし、その機種名はリポジトリの README に1行で記す。

#### Scenario: 機種の基準を知りたい
- **WHEN** 利用者が自動メニュー番号の基準となる機種を確認したい
- **THEN** README に現在の機種名が1行で記されている

#### Scenario: 機種項目を書いても無視される
- **WHEN** frontmatter に機種を表すキーを書く
- **THEN** ビルドは失敗せず、その項目を検索用データに含めない

### Requirement: 本文は手順・メモ
frontmatter に続く本文は Markdown（CommonMark）で書かれた手順・メモであり、任意（空でもよい）。ビルドは少なくとも見出し・箇条書き・番号付きリスト・段落を扱えなければならない（SHALL）。独自記法は追加しない。

#### Scenario: 本文が空
- **WHEN** frontmatter のあとに本文が無い
- **THEN** ビルドは通過し、そのレシピの本文は空として扱われる

#### Scenario: 本文がある
- **WHEN** 本文に見出しと番号付きリストで手順が書かれている
- **THEN** ビルドはそれを検索用データの本文として保持する
