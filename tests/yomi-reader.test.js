import { describe, expect, it } from 'vitest';
import {
  isYomiReaderAvailable,
  readSegments,
  YomiUnavailableError,
} from '../scripts/yomi-reader.mjs';
import { collectYomiTexts, generateYomiTable } from '../scripts/build-yomi.mjs';
import { compileYomiTable, toYomi } from '../scripts/yomi-table.mjs';

// 読みの取得だけが OS に依存する(design D-14)。ここは macOS でのみ動かし、CI では飛ばす。
// 飛ばしても困らないのは、生成された対応表をコミットするからで、ビルドと検索の正しさは
// OS 非依存のテスト(yomi-table.test.js ほか)で担保している(design D-27)。
const describeOnMac = describe.skipIf(!isYomiReaderAvailable());

describeOnMac('読みの取得（macOS のみ）', () => {
  /** 語を1つ渡して読みだけ取り出す */
  const yomiOf = (word) =>
    readSegments([word])
      .map((s) => s.yomi)
      .join('');

  it('料理でよく使う漢字を読める', () => {
    expect(yomiOf('味噌')).toBe('みそ');
    expect(yomiOf('大根')).toBe('だいこん');
    expect(yomiOf('大蒜')).toBe('にんにく');
    expect(yomiOf('味醂')).toBe('みりん');
  });

  it('ローマ字のまま連結せず、トークンごとにかな化する', () => {
    // ローマ字で連結してから一括変換すると mirin + oosaji が「みりのおさじ」になり、
    // 「みりん」が消える。トークンごとにかな化していればこれは起きない(design D-14)
    const segments = readSegments(['みりん 大さじ2']);

    expect(segments.map((s) => s.yomi)).toEqual(['みりん', 'おおさじ2']);
  });

  it('空白で区切って渡すので、中国語として読まれない', () => {
    // 「生姜 1片」をそのまま渡すと shēng jiāng と読まれ「しぇえんぐじああんぐ」になる。
    // 空白で区切ってから断片ごとに渡せば「しょうが」に戻る(design D-14)
    const segments = readSegments(['生姜 1片']);

    expect(segments[0]).toMatchObject({ surface: '生姜', yomi: 'しょうが' });
    expect(segments.map((s) => s.yomi).join('')).not.toContain('しぇ');
  });

  it('断片全体の読みと、その中の語の両方を返す', () => {
    expect(readSegments(['豚バラ肉'])).toEqual([
      {
        surface: '豚バラ肉',
        yomi: 'ぶたばらにく',
        tokens: [
          { surface: '豚', yomi: 'ぶた' },
          { surface: 'バラ肉', yomi: 'ばらにく' },
        ],
      },
    ]);
  });

  // 誤読は「かなとして妥当な形」で出るため機械では判定できない(design D-14)。
  // 現在の実際の出力をここに固定しておき、変わったときに気づけるようにする。
  // このテストが落ちたらエンジンの読みが変わったということなので、
  // data/yomi.overrides.json の訂正がまだ必要かを見直すこと。
  it('既知の誤読は現状のまま固定する（訂正で直す前提）', () => {
    expect(yomiOf('葱')).toBe('き'); // 正しくは「ねぎ」
    expect(yomiOf('米')).toBe('べい'); // 正しくは「こめ」
  });

  it('文脈で切り方が変わる語も、断片の読みは正しく組み立つ', () => {
    // 「豚バラ大根」は 豚バラ/大根、「豚バラ肉」は 豚/バラ肉 と切れる。
    // 断片の読みを持っておけば、どちらも全体として正しく読める(design D-17 帰結)
    const segments = readSegments(['豚バラ大根', '豚バラ肉']);

    expect(segments.map((s) => s.yomi)).toEqual(['ぶたばらだいこん', 'ぶたばらにく']);
  });
});

describe.skipIf(isYomiReaderAvailable())('読みを取得できない環境', () => {
  it('取得しようとするとエラーになる', () => {
    expect(() => readSegments(['味噌'])).toThrow(YomiUnavailableError);
  });
});

describe('読みを取りたいテキストの集め方', () => {
  const recipe = {
    title: 'サバの味噌煮',
    ingredients: ['サバ 2切れ', '味噌 大さじ2'],
    auto_key: 'サバの味噌煮',
    menu_no: '052',
    manual_note: '仕上げに5分だけ追加加熱',
    body: '## 手順\n1. 霜降りにする',
  };

  it('料理名・材料・自動調理キー・手動設定を集める', () => {
    expect(collectYomiTexts([recipe])).toEqual([
      'サバの味噌煮',
      'サバ 2切れ',
      '味噌 大さじ2',
      'サバの味噌煮',
      '仕上げに5分だけ追加加熱',
    ]);
  });

  it('自動メニュー番号と本文は集めない', () => {
    // 番号は数字、本文は長文で読みを持つ利得が小さい(design D-18)
    const texts = collectYomiTexts([recipe]);

    expect(texts).not.toContain('052');
    expect(texts.join('')).not.toContain('手順');
  });

  it('空の任意項目は落とす', () => {
    const texts = collectYomiTexts([
      { title: '蒸し野菜', ingredients: ['にんじん'], auto_key: '', manual_note: '  ' },
    ]);

    expect(texts).toEqual(['蒸し野菜', 'にんじん']);
  });
});

describe('対応表の生成（読みの取得を差し替えて検証）', () => {
  it('集めたテキストから対応表を組み立てる', () => {
    const fakeReader = () => [
      {
        surface: '味噌',
        yomi: 'みそ',
        tokens: [{ surface: '味噌', yomi: 'みそ' }],
      },
      {
        surface: '大さじ2',
        yomi: 'おおさじ2',
        tokens: [
          { surface: '大さじ', yomi: 'おおさじ' },
          { surface: '2', yomi: '2' },
        ],
      },
    ];

    const table = generateYomiTable(
      [{ title: '味噌汁', ingredients: ['味噌 大さじ2'], auto_key: '', manual_note: '' }],
      fakeReader,
    );

    expect(table).toEqual({ 大さじ: 'おおさじ', 大さじ2: 'おおさじ2', 味噌: 'みそ' });
  });

  it('文脈で切り方が変わっても、断片の読みが最長一致で勝つ', () => {
    // 語だけを積むと「豚バラ」が「豚バラ肉」を潰して「ぶたばら肉」になる(design D-17 帰結)
    const fakeReader = () => [
      {
        surface: '豚バラ大根',
        yomi: 'ぶたばらだいこん',
        tokens: [
          { surface: '豚バラ', yomi: 'ぶたばら' },
          { surface: '大根', yomi: 'だいこん' },
        ],
      },
      {
        surface: '豚バラ肉',
        yomi: 'ぶたばらにく',
        tokens: [
          { surface: '豚', yomi: 'ぶた' },
          { surface: 'バラ肉', yomi: 'ばらにく' },
        ],
      },
    ];

    const table = generateYomiTable(
      [{ title: '豚バラ大根', ingredients: ['豚バラ肉 200g'], auto_key: '', manual_note: '' }],
      fakeReader,
    );

    expect(toYomi('豚バラ肉 200g', compileYomiTable(table))).toBe('ぶたばらにく 200g');
    expect(toYomi('豚バラ大根', compileYomiTable(table))).toBe('ぶたばらだいこん');
  });

  it('読みの取得が失敗したらそのまま失敗する', () => {
    const failingReader = () => {
      throw new YomiUnavailableError('使えません');
    };

    expect(() =>
      generateYomiTable(
        [{ title: '味噌汁', ingredients: ['味噌'], auto_key: '', manual_note: '' }],
        failingReader,
      ),
    ).toThrow(YomiUnavailableError);
  });
});
