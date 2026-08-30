import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BuildError, buildIndex, RECIPE_KEYS } from '../scripts/build-index.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** @type {string} */
let workDir;
/** @type {string} */
let outFile;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'hotcook-'));
  outFile = join(workDir, 'recipes.json');
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/** フィクスチャからビルドし、書き出された JSON を読み返す */
function build(fixture) {
  const result = buildIndex({ recipesDir: resolve(FIXTURES, fixture), outFile });
  return { result, written: JSON.parse(readFileSync(outFile, 'utf8')) };
}

/** ビルドが BuildError で失敗することを確かめ、その不備一覧を返す */
function buildExpectingFailure(fixture) {
  try {
    buildIndex({ recipesDir: resolve(FIXTURES, fixture), outFile });
  } catch (e) {
    expect(e).toBeInstanceOf(BuildError);
    return e.issues;
  }
  throw new Error('ビルドが失敗しなかった');
}

describe('buildIndex（正常系）', () => {
  it('レシピの件数だけ要素を持つ配列を書き出す', () => {
    const { result, written } = build('valid');

    expect(result.count).toBe(3);
    expect(written).toHaveLength(3);
  });

  it('各レシピは決められた12キーをちょうど持つ', () => {
    const { written } = build('valid');

    for (const recipe of written) {
      expect(Object.keys(recipe)).toEqual(RECIPE_KEYS);
    }
  });

  it('ID はファイル名から決まる', () => {
    const { written } = build('valid');

    expect(written.map((r) => r.id).sort()).toEqual([
      'butabara-daikon',
      'mushi-yasai-salad',
      'saba-misoni',
    ]);
  });

  it('書かれていない任意項目は空文字になる', () => {
    const { written } = build('optional-missing');

    expect(written[0]).toMatchObject({ auto_key: '', menu_no: '', manual_note: '' });
  });

  it('自動調理キーと手動設定は同時に持てる', () => {
    const { written } = build('valid');
    const recipe = written.find((r) => r.id === 'butabara-daikon');

    expect(recipe.auto_key).toBe('豚の角煮');
    expect(recipe.manual_note).toBe('仕上げに追加加熱');
  });

  it('menu_no の先頭ゼロを保つ', () => {
    const { written } = build('valid');

    expect(written.find((r) => r.id === 'butabara-daikon').menu_no).toBe('048');
  });

  it('材料は前後の空白を除き、空要素を落とす', () => {
    const { written } = build('valid');

    expect(written.find((r) => r.id === 'mushi-yasai-salad').ingredients).toEqual([
      'ブロッコリー 1/2株',
      'にんじん 1/2本',
    ]);
  });

  it('未知のキー（機種など）は検索インデックスに含めない', () => {
    const { written } = build('valid');
    const recipe = written.find((r) => r.id === 'saba-misoni');

    expect(recipe).not.toHaveProperty('model');
    expect(Object.keys(recipe)).toEqual(RECIPE_KEYS);
  });

  it('料理名の日本語ロケール昇順に並ぶ', () => {
    const { written } = build('valid');

    expect(written.map((r) => r.title)).toEqual(['サバの味噌煮', '蒸し野菜サラダ', '豚バラ大根']);
  });

  it('同じ入力から2回ビルドすると同一の JSON になる', () => {
    buildIndex({ recipesDir: join(FIXTURES, 'valid'), outFile });
    const first = readFileSync(outFile, 'utf8');
    buildIndex({ recipesDir: join(FIXTURES, 'valid'), outFile });
    const second = readFileSync(outFile, 'utf8');

    expect(second).toBe(first);
  });

  it('本文が無ければ body と body_html はともに空文字になる', () => {
    const { written } = build('optional-missing');

    expect(written[0].body).toBe('');
    expect(written[0].body_html).toBe('');
  });

  it('本文中の水平線は本文として残る', () => {
    const { written } = build('valid');

    expect(written.find((r) => r.id === 'butabara-daikon').body).toContain('---');
  });
});

describe('buildIndex（本文の変換）', () => {
  it('見出しと番号付きリストを HTML 要素に変換する', () => {
    const { written } = build('raw-html');
    const html = written[0].body_html;

    expect(html).toContain('<h2>手順</h2>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>切る</li>');
  });

  it('body には Markdown ソースがそのまま残る', () => {
    const { written } = build('raw-html');

    expect(written[0].body).toContain('## 手順');
    expect(written[0].body).toContain('1. 切る');
  });

  it('生の HTML はタグとして解釈されずエスケープされる', () => {
    const { written } = build('raw-html');
    const html = written[0].body_html;

    expect(html).not.toContain('<script');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;');
  });
});

describe('buildIndex（fail fast）', () => {
  it('レシピが1件も無ければ失敗する', () => {
    const issues = buildExpectingFailure('empty');

    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/レシピが1件もありません/);
  });

  it('frontmatter が無ければファイル名と理由を報告する', () => {
    const issues = buildExpectingFailure('no-frontmatter');

    expect(issues[0].file).toBe('no-frontmatter.md');
    expect(issues[0].message).toMatch(/frontmatter がありません/);
  });

  it('title が空なら失敗する', () => {
    const issues = buildExpectingFailure('no-title');

    expect(issues[0].file).toBe('no-title.md');
    expect(issues[0].message).toMatch(/title が必要です/);
  });

  it('ingredients が空なら失敗する', () => {
    const issues = buildExpectingFailure('ingredients-empty');

    expect(issues[0].message).toMatch(/ingredients を1件以上/);
  });

  it('ingredients がリストでなければ失敗する', () => {
    const issues = buildExpectingFailure('ingredients-not-list');

    expect(issues[0].message).toMatch(/ingredients はリストで/);
  });

  it('YAML が壊れていれば解析エラーの内容を報告する', () => {
    const issues = buildExpectingFailure('broken-yaml');

    expect(issues[0].file).toBe('broken-yaml.md');
    expect(issues[0].message).toMatch(/YAML を解析できません/);
  });

  it('複数のレシピの不備をまとめて報告する', () => {
    writeFileSync(join(workDir, 'a.md'), '---\ningredients:\n  - 大根\n---\n');
    writeFileSync(join(workDir, 'b.md'), '---\ntitle: 材料なし\n---\n');
    writeFileSync(join(workDir, 'c.md'), '---\ntitle: 正常\ningredients:\n  - 大根\n---\n');

    const issues = buildExpectingFailure(workDir);

    expect(issues.map((i) => i.file).sort()).toEqual(['a.md', 'b.md']);
  });

  // 仕様は各項目を「1行の文字列」と定めている。入れ子（マッピングやリスト）を
  // 書かれた場合は仕様に明示が無いため、黙って "[object Object]" にせず不備として報告する。
  it('title が入れ子なら文字列で書くよう報告する', () => {
    writeFileSync(
      join(workDir, 'a.md'),
      '---\ntitle:\n  ja: 豚バラ大根\ningredients:\n  - 大根\n---\n',
    );

    const issues = buildExpectingFailure(workDir);

    expect(issues[0].message).toMatch(/title は1行の文字列で/);
  });

  it('材料の要素が入れ子なら文字列で書くよう報告する', () => {
    writeFileSync(
      join(workDir, 'a.md'),
      '---\ntitle: 豚バラ大根\ningredients:\n  - name: 大根\n---\n',
    );

    const issues = buildExpectingFailure(workDir);

    expect(issues[0].message).toMatch(/ingredients の要素は1行の文字列で/);
  });

  it('任意項目が入れ子なら文字列で書くよう報告する', () => {
    writeFileSync(
      join(workDir, 'a.md'),
      '---\ntitle: 豚バラ大根\ningredients:\n  - 大根\nmenu_no:\n  - "048"\n---\n',
    );

    const issues = buildExpectingFailure(workDir);

    expect(issues[0].message).toMatch(/menu_no は1行の文字列で/);
  });

  it('レシピ置き場が無ければ理由を報告する', () => {
    const issues = buildExpectingFailure(join(workDir, 'not-exist'));

    expect(issues[0].message).toMatch(/レシピ置き場を読めません/);
  });

  it('不備があるときは出力せず、直前の成功版を残す', () => {
    buildIndex({ recipesDir: join(FIXTURES, 'valid'), outFile });
    const before = readFileSync(outFile, 'utf8');

    expect(() => buildIndex({ recipesDir: join(FIXTURES, 'no-title'), outFile })).toThrow(
      BuildError,
    );
    expect(readFileSync(outFile, 'utf8')).toBe(before);
  });
});
