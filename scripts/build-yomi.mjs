// レシピに現れる語の読みを集めて、対応表の自動生成部分(data/yomi.generated.json)を
// まるごと書き直す(npm run yomi:update)。
//
// 著者の訂正(data/yomi.overrides.json)には触れない。触れないことをコードの分岐ではなく
// 「このファイルが overrides のパスを一度も参照しない」という形で保証する(design D-15)。
// 訂正が静かに消えると、誤読が復活したことにも気づけないため。
//
// 読みの取得に失敗したときは1バイトも書かずに終わる。書き出しは取得がすべて済んだ
// あとに1回だけ行うので、途中で失敗すれば既存の対応表はそのまま残る(design D-14)。

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BuildError, buildRecipes, readRecipeEntries } from './build-index.mjs';
import { readSegments, YomiUnavailableError } from './yomi-reader.mjs';
import { buildYomiTable } from './yomi-table.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_RECIPES_DIR = join(ROOT, 'recipes');
const DEFAULT_GENERATED_FILE = join(ROOT, 'data', 'yomi.generated.json');

/**
 * 読みを取りたいテキストをレシピから集める。
 *
 * 対象は料理名・材料・自動調理キー・手動設定の4つ。自動メニュー番号は数字なので、
 * 本文は長文で読みを持つ利得が小さいので、どちらも対象にしない(design D-18)。
 *
 * @param {object[]} recipes 検索インデックスのレシピオブジェクト
 * @returns {string[]}
 */
export function collectYomiTexts(recipes) {
  const texts = [];
  for (const recipe of recipes) {
    texts.push(recipe.title, ...recipe.ingredients, recipe.auto_key, recipe.manual_note);
  }
  return texts.filter((t) => typeof t === 'string' && t.trim() !== '');
}

/**
 * 対応表の自動生成部分を作る。
 *
 * readSegmentsImpl を差し替えられるようにしてあるのは、読みの取得だけが OS に依存する
 * からで、それ以外の道筋は macOS でなくてもテストできるようにするため(design D-27)。
 *
 * @param {object[]} recipes
 * @param {(texts: string[]) => {surface: string, yomi: string, tokens: object[]}[]} readSegmentsImpl
 * @returns {Record<string, string | null>}
 * @throws {YomiUnavailableError} 読みを取得できない場合
 */
export function generateYomiTable(recipes, readSegmentsImpl = readSegments) {
  return buildYomiTable(readSegmentsImpl(collectYomiTexts(recipes)));
}

/**
 * レシピを読み、対応表の自動生成部分を書き出す。
 * @param {{ recipesDir?: string, generatedFile?: string, readSegmentsImpl?: Function }} options
 * @returns {{ table: Record<string, string | null>, generatedFile: string, unreadable: string[] }}
 * @throws {BuildError} レシピが1件も無い、または不備がある場合
 * @throws {YomiUnavailableError} 読みを取得できない場合(このとき何も書き出さない)
 */
export function updateYomiTable({
  recipesDir = DEFAULT_RECIPES_DIR,
  generatedFile = DEFAULT_GENERATED_FILE,
  readSegmentsImpl = readSegments,
} = {}) {
  const entries = readRecipeEntries(recipesDir);
  const { recipes, issues } = buildRecipes(entries);

  // レシピに不備があるまま対応表を作ると、直したあとに作り直す羽目になる。
  // どのみちビルドは通らないので、ここで止める。
  if (issues.length > 0) throw new BuildError(issues);

  // ここで失敗すれば書き出しに進まない = 既存の対応表は変更されない
  const table = generateYomiTable(recipes, readSegmentsImpl);

  mkdirSync(dirname(generatedFile), { recursive: true });
  writeFileSync(generatedFile, `${JSON.stringify(table, null, 2)}\n`);

  const unreadable = Object.keys(table).filter((word) => table[word] === null);
  return { table, generatedFile, unreadable };
}

// --- CLI (npm run yomi:update) ----------------------------------------------

const isCli =
  process.argv[1] != null && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isCli) {
  try {
    const { table, generatedFile, unreadable } = updateYomiTable();
    const count = Object.keys(table).length;
    console.log(`✔ 読みの対応表を作り直しました（${count}語）: ${relative(ROOT, generatedFile)}`);
    if (unreadable.length > 0) {
      console.log(`\n  読みを取得できなかった語（${unreadable.length}件）:`);
      for (const word of unreadable) console.log(`    - ${word}`);
      console.log('\n  data/yomi.overrides.json に読みを書くと、かなで引けるようになります。');
    }
    console.log('\n  誤読は機械では判定できません。差分を目で確認してからコミットしてください。');
  } catch (e) {
    if (e instanceof YomiUnavailableError) {
      console.error(`\n✖ ${e.message}`);
      console.error('  対応表は変更していません。');
      console.error('  読みの取得には macOS が必要です（背景は design の D-14 を参照）。\n');
      process.exit(1);
    }
    if (e instanceof BuildError) {
      console.error('\n✖ レシピに不備があります。直してから、もう一度実行してください\n');
      for (const { file, message } of e.issues) console.error(`  - ${file}: ${message}`);
      console.error('');
      process.exit(1);
    }
    throw e;
  }
}
