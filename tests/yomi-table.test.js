import { describe, expect, it } from 'vitest';
import {
  buildYomiTable,
  collectYomiWarnings,
  compileYomiTable,
  isYomiTarget,
  mergeYomiTable,
  normalizeYomi,
  toYomi,
} from '../scripts/yomi-table.mjs';

/** 読みを引ける形にしてから toYomi に渡すだけの短縮形 */
const convert = (text, table) => toYomi(text, compileYomiTable(table));

describe('対応表に載せる語の判定', () => {
  it('漢字を含む語は載せる', () => {
    expect(isYomiTarget('味噌')).toBe(true);
    expect(isYomiTarget('バラ肉')).toBe(true);
    expect(isYomiTarget('大さじ')).toBe(true);
  });

  it('数字・記号・ラテン文字だけの語は載せない', () => {
    // 「200g → 200ぐ」のようなノイズを避ける(design D-17 帰結)
    expect(isYomiTarget('200g')).toBe(false);
    expect(isYomiTarget('1/2')).toBe(false);
    expect(isYomiTarget('olive')).toBe(false);
  });

  it('かな・カナだけの語は載せない', () => {
    // 表記の違いはブラウザ側の正規化で吸収される。むしろ読みを経由すると
    // 「ブロッコリー → ぶろっこりい」と長音が崩れて害になる
    expect(isYomiTarget('にんじん')).toBe(false);
    expect(isYomiTarget('ブロッコリー')).toBe(false);
  });
});

describe('取得した読みの検証', () => {
  it('読めた読みはそのまま通す', () => {
    expect(normalizeYomi('みそ')).toBe('みそ');
    expect(normalizeYomi('  みそ  ')).toBe('みそ');
  });

  it('空や漢字が残ったものは読めていないとみなす', () => {
    expect(normalizeYomi('')).toBeNull();
    expect(normalizeYomi('   ')).toBeNull();
    expect(normalizeYomi('味噌')).toBeNull();
    expect(normalizeYomi('みそ味噌')).toBeNull();
    expect(normalizeYomi(undefined)).toBeNull();
  });
});

describe('自動生成部分の組み立て', () => {
  it('漢字を含む語だけを集め、読めなかった語は null で残す', () => {
    const table = buildYomiTable([
      { surface: '味噌', yomi: 'みそ' },
      { surface: '大さじ', yomi: 'おおさじ' },
      { surface: '2', yomi: '2' },
      { surface: 'にんじん', yomi: 'にんじん' },
      { surface: '自家製', yomi: '自家製' },
    ]);

    expect(table).toEqual({ 大さじ: 'おおさじ', 自家製: null, 味噌: 'みそ' });
  });

  it('同じ語が複数回現れたら、読めたほうを採る', () => {
    const table = buildYomiTable([
      { surface: '生姜', yomi: '' },
      { surface: '生姜', yomi: 'しょうが' },
    ]);

    expect(table.生姜).toBe('しょうが');
  });

  it('同じ入力からは常に同じ表になる（キーの順序も含めて）', () => {
    const tokens = [
      { surface: '大根', yomi: 'だいこん' },
      { surface: '味噌', yomi: 'みそ' },
      { surface: '豚', yomi: 'ぶた' },
    ];

    expect(JSON.stringify(buildYomiTable(tokens))).toBe(JSON.stringify(buildYomiTable(tokens)));
  });
});

describe('訂正の重ね方', () => {
  it('訂正は自動生成の値に勝つ', () => {
    const merged = mergeYomiTable({ 葱: 'き', 味噌: 'みそ' }, { 葱: 'ねぎ' });

    expect(merged).toEqual({ 葱: 'ねぎ', 味噌: 'みそ' });
  });

  it('読めなかった語を訂正で埋められる', () => {
    expect(mergeYomiTable({ 自家製: null }, { 自家製: 'じかせい' }).自家製).toBe('じかせい');
  });

  it('自動生成に無い語も訂正として足せる', () => {
    expect(mergeYomiTable({}, { 鯖: 'さば' }).鯖).toBe('さば');
  });
});

describe('最長一致での読み付与', () => {
  const table = {
    味噌: 'みそ',
    味噌煮: 'みそに',
    大さじ: 'おおさじ',
    豚: 'ぶた',
    バラ肉: 'ばらにく',
  };

  it('長い語を優先して置き換える', () => {
    expect(convert('サバの味噌煮', table)).toBe('サバのみそに');
  });

  it('表に無い文字はそのまま残す', () => {
    expect(convert('味噌 大さじ2', table)).toBe('みそ おおさじ2');
  });

  it('語の切れ目に依存せず、連なった語をつなげて読める', () => {
    // 対応表は「豚」と「バラ肉」に分かれて入っているが、分割器を持たずに引ける
    expect(convert('豚バラ肉 200g', table)).toBe('ぶたばらにく 200g');
  });

  it('読めなかった語はその語だけ元の表記のまま残す', () => {
    expect(convert('自家製の味噌', { 自家製: null, 味噌: 'みそ' })).toBe('自家製のみそ');
  });

  it('空文字は空文字のまま', () => {
    expect(convert('', table)).toBe('');
  });

  it('表が空でも入力をそのまま返す', () => {
    expect(convert('味噌', {})).toBe('味噌');
  });
});

describe('対応表の警告', () => {
  it('読めないまま訂正も無い語を知らせる', () => {
    const warnings = collectYomiWarnings({ 自家製: null }, {});

    expect(warnings).toHaveLength(1);
    expect(warnings[0].word).toBe('自家製');
  });

  it('訂正で埋めた語は警告しない', () => {
    expect(collectYomiWarnings({ 自家製: null }, { 自家製: 'じかせい' })).toEqual([]);
  });

  it('どのレシピにも現れない語の訂正を知らせる', () => {
    const warnings = collectYomiWarnings({ 味噌: 'みそ' }, { 蓮根: 'れんこん' });

    expect(warnings).toHaveLength(1);
    expect(warnings[0].word).toBe('蓮根');
    expect(warnings[0].message).toContain('削除できます');
  });

  it('自動生成と同じ値になった訂正を知らせる', () => {
    const warnings = collectYomiWarnings({ 葱: 'ねぎ' }, { 葱: 'ねぎ' });

    expect(warnings).toHaveLength(1);
    expect(warnings[0].word).toBe('葱');
    expect(warnings[0].message).toContain('削除できます');
  });

  it('訂正が正しく効いているあいだは何も言わない', () => {
    expect(collectYomiWarnings({ 葱: 'き', 味噌: 'みそ' }, { 葱: 'ねぎ' })).toEqual([]);
  });
});
