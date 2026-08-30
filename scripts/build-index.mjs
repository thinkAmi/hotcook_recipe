// recipes/*.md を読み、検索インデックス public/recipes.json を生成するビルド。
//
// 不備は1件目で止めず全件集めてからまとめて失敗させ、1回のビルドで全部直せるようにする
// (design D-04)。不備が1件でもあれば出力しないので、壊れたインデックスで上書きされない。

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import { parseFrontmatter } from './frontmatter.mjs';
import {
  collectYomiWarnings,
  compileYomiTable,
  hasUnconvertedKanji,
  mergeYomiTable,
  toYomi,
} from './yomi-table.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_RECIPES_DIR = join(ROOT, 'recipes');
const DEFAULT_OUT_FILE = join(ROOT, 'public', 'recipes.json');
const DEFAULT_YOMI_DIR = join(ROOT, 'data');

/** 対応表を渡されなかったときに使う空の表。読みは元の表記のままになる */
const EMPTY_YOMI = compileYomiTable({});

// html: false で本文中の生 HTML をエスケープし、信頼境界をビルド時に確定させる(design D-03)。
// linkify は使わない(リンクは Markdown のリンク記法で書く)。
const md = new MarkdownIt({ html: false, breaks: true, linkify: false });

// 検索インデックスの1レシピが持つキー。順序も出力の順序になる。
//
// 読みは料理名・材料・自動調理キー・手動設定にだけ持たせる。自動メニュー番号は数字、
// 本文は長文で読みを持つ利得が小さい(design D-18)。読みのキーは常に存在し常に文字列で、
// 元の表記と同じ値になる場合も省略しない(D-06 の踏襲)。
const RECIPE_KEYS = [
  'id',
  'title',
  'title_yomi',
  'ingredients',
  'ingredients_yomi',
  'auto_key',
  'auto_key_yomi',
  'menu_no',
  'manual_note',
  'manual_note_yomi',
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
 * @param {Map<string, [string, string | null][]>} compiled 読みの対応表
 * @returns {{ recipe?: object, issues: string[] }}
 */
function toRecipe(slug, data, content, compiled) {
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
      title_yomi: toYomi(title, compiled),
      ingredients,
      // 材料の読みは元の材料と要素数・順序で対応する
      ingredients_yomi: ingredients.map((ingredient) => toYomi(ingredient, compiled)),
      auto_key: optional.auto_key,
      auto_key_yomi: toYomi(optional.auto_key, compiled),
      menu_no: optional.menu_no,
      manual_note: optional.manual_note,
      manual_note_yomi: toYomi(optional.manual_note, compiled),
      body,
      body_html: body === '' ? '' : md.render(body),
    },
    issues: [],
  };
}

/**
 * レシピファイルの中身から検索インデックスを組み立てる純関数。
 * @param {{ file: string, slug: string, raw: string }[]} entries
 * @param {Map<string, [string, string | null][]>} compiled 読みの対応表(省略時は読みを引かない)
 * @returns {{ recipes: object[], issues: { file: string, message: string }[] }}
 */
export function buildRecipes(entries, compiled = EMPTY_YOMI) {
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

    const { recipe, issues: recipeIssues } = toRecipe(slug, parsed.data, parsed.content, compiled);
    for (const message of recipeIssues) issues.push({ file, message });
    if (recipe) recipes.push(recipe);
  }

  // 料理名の日本語ロケール昇順。同名は ID で決着させ、列挙順に左右されないようにする(design D-07)
  recipes.sort((a, b) => a.title.localeCompare(b.title, 'ja') || a.id.localeCompare(b.id));

  return { recipes, issues };
}

/**
 * 対応表のファイルを1つ読む。
 * @param {string} file
 * @param {boolean} required 無いときに失敗させるか
 * @returns {Record<string, string | null>}
 * @throws {BuildError}
 */
function readYomiFile(file, required) {
  const shown = relative(ROOT, file);

  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (e) {
    // 訂正がまだ1件も無いのは正常な状態なので、無ければ空として扱う
    if (e.code === 'ENOENT' && !required) return {};
    const message =
      e.code === 'ENOENT'
        ? '読みの対応表がありません。npm run yomi:update で作成してください'
        : `読みの対応表を読めません: ${e.message}`;
    throw new BuildError([{ file: shown, message }]);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new BuildError([{ file: shown, message: `読みの対応表を解析できません: ${e.message}` }]);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BuildError([
      { file: shown, message: '読みの対応表は「語: 読み」の形にしてください' },
    ]);
  }
  return parsed;
}

/**
 * 読みの対応表を読み込む。
 *
 * 自動生成部分が無い・壊れているときはビルドを失敗させる。読みの欠けたインデックスで
 * 直前の成功版を上書きしないため(spec「対応表を読めないときはビルドを失敗させる」)。
 * 訂正はまだ1件も無くてよい。
 *
 * @param {string} yomiDir
 * @returns {{ generated: Record<string, string|null>, overrides: Record<string, string|null> }}
 * @throws {BuildError}
 */
export function loadYomiTable(yomiDir = DEFAULT_YOMI_DIR) {
  return {
    generated: readYomiFile(join(yomiDir, 'yomi.generated.json'), true),
    overrides: readYomiFile(join(yomiDir, 'yomi.overrides.json'), false),
  };
}

/**
 * レシピ置き場のファイルを読み込む。読みの生成(build-yomi.mjs)も同じ入力を使うので
 * 切り出してある。
 * @param {string} recipesDir
 * @returns {{ file: string, slug: string, raw: string }[]} ファイル名順
 * @throws {BuildError} 置き場を読めない、またはレシピが1件も無い場合
 */
export function readRecipeEntries(recipesDir = DEFAULT_RECIPES_DIR) {
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

  return files.map((file) => ({
    file,
    slug: file.slice(0, -'.md'.length),
    raw: readFileSync(join(recipesDir, file), 'utf8'),
  }));
}

/**
 * 読みが付ききらなかった項目を集める(design D-28)。
 *
 * 読みに漢字が残っていれば、その項目はかなで打っても引けない。誤読と違ってこれは
 * 機械で判定できるので、静かに壊れたままにせず警告する。ビルドは失敗させない。
 *
 * @param {object[]} recipes
 * @returns {{ word: string, message: string }[]}
 */
export function collectUnconvertedWarnings(recipes) {
  const warnings = [];

  for (const recipe of recipes) {
    const check = (source, yomi) => {
      if (source !== '' && hasUnconvertedKanji(yomi)) {
        warnings.push({
          word: `${recipe.id}「${source}」`,
          message: `読みに漢字が残っています（${yomi}）。対応表に語が足りていません`,
        });
      }
    };

    check(recipe.title, recipe.title_yomi);
    recipe.ingredients.forEach((ingredient, i) => check(ingredient, recipe.ingredients_yomi[i]));
    check(recipe.auto_key, recipe.auto_key_yomi);
    check(recipe.manual_note, recipe.manual_note_yomi);
  }

  return warnings;
}

/**
 * レシピを読み込んで検索インデックスを書き出す。
 * @param {{ recipesDir?: string, outFile?: string, yomiDir?: string }} options
 * @returns {{ count: number, outFile: string, recipes: object[], warnings: object[] }}
 * @throws {BuildError} レシピが1件も無い、不備がある、対応表を読めない場合(出力はしない)
 */
export function buildIndex({
  recipesDir = DEFAULT_RECIPES_DIR,
  outFile = DEFAULT_OUT_FILE,
  yomiDir = DEFAULT_YOMI_DIR,
} = {}) {
  const { generated, overrides } = loadYomiTable(yomiDir);
  const compiled = compileYomiTable(mergeYomiTable(generated, overrides));

  const entries = readRecipeEntries(recipesDir);

  const { recipes, issues } = buildRecipes(entries, compiled);

  // 不備があれば書き出さない。壊れたインデックスで直前の成功版を潰さない(design D-04)
  if (issues.length > 0) throw new BuildError(issues);

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(recipes, null, 2)}\n`);

  // 対応表についての気づきは警告にとどめ、ビルドは失敗させない(design D-15 帰結・D-28)
  const warnings = [
    ...collectYomiWarnings(generated, overrides),
    ...collectUnconvertedWarnings(recipes),
  ];

  return { count: recipes.length, outFile, recipes, warnings };
}

export { RECIPE_KEYS };

// --- CLI (npm run build) -----------------------------------------------------

// import.meta.main は Node 24.2 未満に無く、使うと古い版で「何もせず成功」してしまう。
// 版に依存しない argv 比較で、CLI として起動されたときだけ走らせる。
const isCli =
  process.argv[1] != null && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isCli) {
  try {
    const { count, outFile, warnings } = buildIndex();
    console.log(`✔ 検索インデックスを生成しました（${count}件）: ${relative(ROOT, outFile)}`);
    if (warnings.length > 0) {
      console.warn(`\n⚠ 読みの対応表について（${warnings.length}件）`);
      for (const { word, message } of warnings) console.warn(`  - ${word}: ${message}`);
      console.warn('');
    }
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
