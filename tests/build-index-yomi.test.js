import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BuildError, buildIndex, collectUnconvertedWarnings } from '../scripts/build-index.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const VALID = join(FIXTURES, 'valid');

let workDir;
let outFile;
let yomiDir;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'hotcook-yomi-build-'));
  outFile = join(workDir, 'recipes.json');
  yomiDir = join(workDir, 'data');
  mkdirSync(yomiDir, { recursive: true });
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/** 対応表を書いてからビルドし、書き出された JSON を読み返す */
function buildWith(generated, overrides) {
  if (generated !== undefined) {
    writeFileSync(join(yomiDir, 'yomi.generated.json'), JSON.stringify(generated));
  }
  if (overrides !== undefined) {
    writeFileSync(join(yomiDir, 'yomi.overrides.json'), JSON.stringify(overrides));
  }
  const result = buildIndex({ recipesDir: VALID, outFile, yomiDir });
  return { result, written: JSON.parse(readFileSync(outFile, 'utf8')) };
}

/** ビルドが BuildError で失敗することを確かめ、その不備一覧を返す */
function buildExpectingFailure() {
  try {
    buildIndex({ recipesDir: VALID, outFile, yomiDir });
  } catch (e) {
    expect(e).toBeInstanceOf(BuildError);
    return e.issues;
  }
  throw new Error('ビルドが失敗しなかった');
}

describe('検索インデックスへの読みの焼き込み', () => {
  it('対応表にある語を読みに変える', () => {
    const { written } = buildWith({ 味噌: 'みそ', 煮: 'に' });
    const recipe = written.find((r) => r.id === 'saba-misoni');

    expect(recipe.title).toBe('サバの味噌煮');
    expect(recipe.title_yomi).toBe('サバのみそに');
  });

  it('読みのキーは常に存在し、常に文字列になる', () => {
    const { written } = buildWith({});

    for (const recipe of written) {
      for (const key of ['title_yomi', 'auto_key_yomi', 'manual_note_yomi']) {
        expect(typeof recipe[key]).toBe('string');
      }
      expect(Array.isArray(recipe.ingredients_yomi)).toBe(true);
    }
  });

  it('材料の読みは材料と要素数・順序で対応する', () => {
    const { written } = buildWith({ 大根: 'だいこん' });

    for (const recipe of written) {
      expect(recipe.ingredients_yomi).toHaveLength(recipe.ingredients.length);
    }
    const recipe = written.find((r) => r.id === 'butabara-daikon');
    const index = recipe.ingredients.findIndex((i) => i.startsWith('大根'));
    expect(recipe.ingredients_yomi[index]).toContain('だいこん');
  });

  it('自動メニュー番号と本文には読みを持たせない', () => {
    const { written } = buildWith({});

    for (const recipe of written) {
      expect(recipe).not.toHaveProperty('menu_no_yomi');
      expect(recipe).not.toHaveProperty('body_yomi');
    }
  });

  it('読みが元の表記と同じでも省略しない', () => {
    // 料理名がすべてかなでも title_yomi は空にならない
    const { written } = buildWith({});
    const recipe = written.find((r) => r.id === 'mushi-yasai-salad');

    expect(recipe.title_yomi).not.toBe('');
  });

  it('読みを取得できなかった語（null）はその語だけ元の表記のまま残す', () => {
    const { written } = buildWith({ 味噌: null, 煮: 'に' });
    const recipe = written.find((r) => r.id === 'saba-misoni');

    expect(recipe.title_yomi).toBe('サバの味噌に');
  });

  it('訂正は自動生成の読みに勝つ', () => {
    const { written } = buildWith({ 味噌: 'まちがい', 煮: 'に' }, { 味噌: 'みそ' });
    const recipe = written.find((r) => r.id === 'saba-misoni');

    expect(recipe.title_yomi).toBe('サバのみそに');
  });

  it('訂正がまだ1件も無くてもビルドは成功する', () => {
    const { result } = buildWith({ 味噌: 'みそ' });

    expect(result.count).toBe(3);
  });
});

describe('対応表が読めないとき（fail fast）', () => {
  it('自動生成部分が無ければ失敗し、作り方を伝える', () => {
    const issues = buildExpectingFailure();

    expect(issues[0].message).toMatch(/npm run yomi:update/);
  });

  it('自動生成部分が壊れていれば失敗する', () => {
    writeFileSync(join(yomiDir, 'yomi.generated.json'), '{ 壊れた');

    const issues = buildExpectingFailure();

    expect(issues[0].message).toMatch(/解析できません/);
  });

  it('対応表が「語: 読み」の形でなければ失敗する', () => {
    writeFileSync(join(yomiDir, 'yomi.generated.json'), '["味噌"]');

    const issues = buildExpectingFailure();

    expect(issues[0].message).toMatch(/「語: 読み」の形/);
  });

  it('訂正が壊れていれば失敗する', () => {
    writeFileSync(join(yomiDir, 'yomi.generated.json'), '{}');
    writeFileSync(join(yomiDir, 'yomi.overrides.json'), '{ 壊れた');

    const issues = buildExpectingFailure();

    expect(issues[0].message).toMatch(/解析できません/);
  });

  it('対応表が読めないときは出力せず、直前の成功版を残す', () => {
    buildWith({ 味噌: 'みそ' });
    const before = readFileSync(outFile, 'utf8');

    writeFileSync(join(yomiDir, 'yomi.generated.json'), '{ 壊れた');
    expect(() => buildIndex({ recipesDir: VALID, outFile, yomiDir })).toThrow(BuildError);

    expect(readFileSync(outFile, 'utf8')).toBe(before);
  });
});

describe('対応表についての警告', () => {
  it('読めないまま訂正も無い語を知らせる', () => {
    const { result } = buildWith({ 味噌: null });

    expect(result.warnings.some((w) => w.word === '味噌')).toBe(true);
  });

  it('どのレシピにも現れない語の訂正を知らせる', () => {
    const { result } = buildWith({ 味噌: 'みそ' }, { 蓮根: 'れんこん' });

    expect(result.warnings.some((w) => w.word === '蓮根')).toBe(true);
  });

  it('自動生成と同じ値の訂正を知らせる', () => {
    const { result } = buildWith({ 味噌: 'みそ' }, { 味噌: 'みそ' });

    expect(result.warnings.some((w) => w.word === '味噌')).toBe(true);
  });

  it('読みに漢字が残っていることを知らせる', () => {
    // 「味噌」は引けるが「煮」が表に無いので「サバのみそ煮」になる(design D-28)
    const { result } = buildWith({ 味噌: 'みそ' });
    const warning = result.warnings.find((w) => w.word.includes('サバの味噌煮'));

    expect(warning).toBeDefined();
    expect(warning.message).toMatch(/読みに漢字が残っています/);
  });

  it('警告が出てもビルドは失敗せず、インデックスは書き出される', () => {
    const { result, written } = buildWith({ 味噌: null });

    expect(written).toHaveLength(3);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('読みが行き渡っていれば何も言わない', () => {
    const warnings = collectUnconvertedWarnings([
      {
        id: 'a',
        title: 'さば',
        title_yomi: 'さば',
        ingredients: ['にんじん'],
        ingredients_yomi: ['にんじん'],
        auto_key: '',
        auto_key_yomi: '',
        manual_note: '',
        manual_note_yomi: '',
      },
    ]);

    expect(warnings).toEqual([]);
  });
});
