// recipes/*.md を読み、検索インデックス public/recipes.json を生成するビルド。
//
// 不備は1件目で止めず全件集めてからまとめて失敗させ、1回のビルドで全部直せるようにする
// (design D-04)。不備が1件でもあれば出力しないので、壊れたインデックスで上書きされない。

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import { parseFrontmatter } from './frontmatter.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_RECIPES_DIR = join(ROOT, 'recipes');
const DEFAULT_OUT_FILE = join(ROOT, 'public', 'recipes.json');

// html: false で本文中の生 HTML をエスケープし、信頼境界をビルド時に確定させる(design D-03)。
// linkify は使わない(リンクは Markdown のリンク記法で書く)。
const md = new MarkdownIt({ html: false, breaks: true, linkify: false });

/** 検索インデックスの1レシピが持つキー。順序も出力の順序になる */
const RECIPE_KEYS = [
  'id',
  'title',
  'ingredients',
  'auto_key',
  'menu_no',
  'manual_note',
  'body',
  'body_html',
];

/** レシピの不備をまとめて運ぶエラー */
export class BuildError extends Error {
  /** @param {{ file: string, message: string }[]} issues */
  constructor(issues) {
    super(`レシピに ${issues.length} 件の不備があります`);
    this.name = 'BuildError';
    this.issues = issues;
  }
}

/**
 * スカラー値を文字列にする。オブジェクト・配列は文字列として扱えないので null を返す。
 * @returns {string | null}
 */
function scalarToString(value) {
  if (value == null) return '';
  if (typeof value === 'object') return null;
  return String(value).trim();
}

/**
 * 1レシピ分の frontmatter を検証し、検索インデックスの形に正規化する。
 * @param {string} slug ファイル名(拡張子なし)。そのままレシピの ID になる(design D-05)
 * @param {Record<string, unknown>} data frontmatter
 * @param {string} content 本文
 * @returns {{ recipe?: object, issues: string[] }}
 */
function toRecipe(slug, data, content) {
  const issues = [];

  const title = scalarToString(data.title);
  if (title === null) {
    issues.push('title は1行の文字列で書いてください');
  } else if (title === '') {
    issues.push('title が必要です(料理名を書いてください)');
  }

  let ingredients = [];
  if (!Array.isArray(data.ingredients)) {
    issues.push(
      data.ingredients == null
        ? 'ingredients が必要です(材料を1件以上、リストで書いてください)'
        : 'ingredients はリストで書いてください(先頭が "- " の行を並べる)',
    );
  } else {
    const converted = data.ingredients.map(scalarToString);
    if (converted.some((v) => v === null)) {
      issues.push('ingredients の要素は1行の文字列で書いてください');
    } else {
      ingredients = converted.filter((v) => v !== '');
      if (ingredients.length === 0) {
        issues.push('ingredients を1件以上書いてください');
      }
    }
  }

  // 任意項目。無ければ空文字にそろえ、下流に存在チェックをさせない(design D-06)
  const optional = {};
  for (const key of ['auto_key', 'menu_no', 'manual_note']) {
    const value = scalarToString(data[key]);
    if (value === null) {
      issues.push(`${key} は1行の文字列で書いてください`);
    } else {
      optional[key] = value;
    }
  }

  if (issues.length > 0) return { issues };

  // body は Markdown ソースのまま検索に使う(design D-08)
  const body = content.trim();

  return {
    recipe: {
      id: slug,
      title,
      ingredients,
      auto_key: optional.auto_key,
      menu_no: optional.menu_no,
      manual_note: optional.manual_note,
      body,
      body_html: body === '' ? '' : md.render(body),
    },
    issues: [],
  };
}

/**
 * レシピファイルの中身から検索インデックスを組み立てる純関数。
 * @param {{ file: string, slug: string, raw: string }[]} entries
 * @returns {{ recipes: object[], issues: { file: string, message: string }[] }}
 */
export function buildRecipes(entries) {
  const recipes = [];
  const issues = [];

  for (const { file, slug, raw } of entries) {
    let parsed;
    try {
      parsed = parseFrontmatter(raw);
    } catch (e) {
      issues.push({ file, message: e.message });
      continue;
    }

    const { recipe, issues: recipeIssues } = toRecipe(slug, parsed.data, parsed.content);
    for (const message of recipeIssues) issues.push({ file, message });
    if (recipe) recipes.push(recipe);
  }

  // 料理名の日本語ロケール昇順。同名は ID で決着させ、列挙順に左右されないようにする(design D-07)
  recipes.sort((a, b) => a.title.localeCompare(b.title, 'ja') || a.id.localeCompare(b.id));

  return { recipes, issues };
}

/**
 * レシピを読み込んで検索インデックスを書き出す。
 * @param {{ recipesDir?: string, outFile?: string }} options
 * @returns {{ count: number, outFile: string, recipes: object[] }}
 * @throws {BuildError} レシピが1件も無い、または不備がある場合(出力はしない)
 */
export function buildIndex({ recipesDir = DEFAULT_RECIPES_DIR, outFile = DEFAULT_OUT_FILE } = {}) {
  let files;
  try {
    files = readdirSync(recipesDir)
      .filter((f) => f.endsWith('.md'))
      .sort();
  } catch (e) {
    throw new BuildError([{ file: recipesDir, message: `レシピ置き場を読めません: ${e.message}` }]);
  }

  if (files.length === 0) {
    throw new BuildError([
      { file: recipesDir, message: 'レシピが1件もありません(.md を置いてください)' },
    ]);
  }

  const entries = files.map((file) => ({
    file,
    slug: file.slice(0, -'.md'.length),
    raw: readFileSync(join(recipesDir, file), 'utf8'),
  }));

  const { recipes, issues } = buildRecipes(entries);

  // 不備があれば書き出さない。壊れたインデックスで直前の成功版を潰さない(design D-04)
  if (issues.length > 0) throw new BuildError(issues);

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(recipes, null, 2)}\n`);

  return { count: recipes.length, outFile, recipes };
}

export { RECIPE_KEYS };

// --- CLI (npm run build) -----------------------------------------------------

// import.meta.main は Node 24.2 未満に無く、使うと古い版で「何もせず成功」してしまう。
// 版に依存しない argv 比較で、CLI として起動されたときだけ走らせる。
const isCli =
  process.argv[1] != null && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isCli) {
  try {
    const { count, outFile } = buildIndex();
    console.log(`✔ 検索インデックスを生成しました（${count}件）: ${relative(ROOT, outFile)}`);
  } catch (e) {
    if (!(e instanceof BuildError)) throw e;
    console.error('\n✖ ビルド失敗: レシピを直してから、もう一度実行してください\n');
    for (const { file, message } of e.issues) {
      console.error(`  - ${file}: ${message}`);
    }
    console.error('');
    process.exit(1);
  }
}
