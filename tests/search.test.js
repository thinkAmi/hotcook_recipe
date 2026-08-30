import { describe, expect, it } from 'vitest';
import {
  cookingMethodLines,
  filterRecipes,
  normalize,
  parseQuery,
  prepare,
  searchableText,
} from '../public/search.js';

/** 検索インデックスの形をした最小のレシピ */
function recipe(overrides) {
  return {
    id: 'sample',
    title: 'サンプル',
    title_yomi: 'さんぷる',
    ingredients: [],
    ingredients_yomi: [],
    auto_key: '',
    auto_key_yomi: '',
    menu_no: '',
    manual_note: '',
    manual_note_yomi: '',
    body: '',
    body_html: '',
    ...overrides,
  };
}

const saba = recipe({
  id: 'saba-misoni',
  title: 'サバの味噌煮',
  title_yomi: 'さばのみそに',
  ingredients: ['サバ 2切れ', '味噌 大さじ2'],
  ingredients_yomi: ['さば 2きれ', 'みそ おおさじ2'],
  auto_key: 'サバの味噌煮',
  auto_key_yomi: 'さばのみそに',
  menu_no: '052',
  body: '## 手順\n1. 霜降りにする',
});

const yasai = recipe({
  id: 'mushi-yasai-salad',
  title: '蒸し野菜サラダ',
  title_yomi: 'むしやさいさらだ',
  ingredients: ['ブロッコリー 1/2株', 'にんじん 1/2本'],
  ingredients_yomi: ['ぶろっこりー 1/2かぶ', 'にんじん 1/2ぽん'],
  manual_note: '蒸し野菜 10分',
  manual_note_yomi: 'むしやさい 10ふん',
});

// 検索インデックスは料理名順に並んでいる(design D-07)
const prepared = prepare([saba, yasai]);
const search = (query) => filterRecipes(prepared, query).map((r) => r.id);

describe('表記のゆれの吸収', () => {
  it('ひらがなとカタカナを区別しない', () => {
    expect(search('さば')).toEqual(['saba-misoni']);
    expect(search('サバ')).toEqual(['saba-misoni']);
  });

  it('全角と半角を区別しない', () => {
    expect(search('０５２')).toEqual(['saba-misoni']);
    expect(search('052')).toEqual(['saba-misoni']);
  });

  it('英字の大文字と小文字を区別しない', () => {
    expect(search('SABA')).toEqual(['saba-misoni']);
    expect(search('saba')).toEqual(['saba-misoni']);
  });

  it('漢字で書かれた材料をかなで引ける（読み経由）', () => {
    // 材料は「味噌 大さじ2」と漢字だが、読み「みそ」で一致する(design D-13)
    expect(search('みそ')).toEqual(['saba-misoni']);
  });

  it('漢字そのものでも引ける', () => {
    expect(search('味噌')).toEqual(['saba-misoni']);
  });

  it('入力側の漢字は読みに読み替えられない', () => {
    // レシピ側が「サバ」とカナなので、「鯖」と打っても当たらない。
    // かなで打てば当たる（割り切った限界。design D-13 見直し条件）
    expect(search('鯖')).toEqual([]);
    expect(search('さば')).toEqual(['saba-misoni']);
  });
});

describe('空白区切りの絞り込み', () => {
  it('すべての語を含むレシピだけを返す', () => {
    expect(search('さば みそ')).toEqual(['saba-misoni']);
  });

  it('語が別々の項目に散っていてもよい', () => {
    // 「さば」は料理名、「きれ」は材料にある
    expect(search('さば きれ')).toEqual(['saba-misoni']);
  });

  it('片方しか含まないレシピは外れる', () => {
    expect(search('さば にんじん')).toEqual([]);
  });

  it('記号は演算子ではなく語の一部として扱う', () => {
    expect(search('!さば')).toEqual([]);
    expect(search('1/2株')).toEqual(['mushi-yasai-salad']);
  });

  it('入力が空なら全件を返す', () => {
    expect(search('')).toEqual(['saba-misoni', 'mushi-yasai-salad']);
    expect(search('   ')).toEqual(['saba-misoni', 'mushi-yasai-salad']);
  });

  it('一致が無ければ空になる', () => {
    expect(search('からあげ')).toEqual([]);
  });
});

describe('検索の対象', () => {
  it('自動メニュー番号で引ける', () => {
    expect(search('052')).toEqual(['saba-misoni']);
  });

  it('レシピの ID をローマ字で引ける', () => {
    expect(search('misoni')).toEqual(['saba-misoni']);
  });

  it('手順の言葉で引ける', () => {
    expect(search('霜降り')).toEqual(['saba-misoni']);
  });

  it('自動調理キーで引ける', () => {
    expect(searchableText(saba).plain).toContain('さばの味噌煮');
  });

  it('手動設定で引ける', () => {
    expect(search('10分')).toEqual(['mushi-yasai-salad']);
  });
});

describe('並び', () => {
  it('絞り込んでも料理名順のまま（入力の順序を変えない）', () => {
    expect(search('1/2')).toEqual(['mushi-yasai-salad']);
    expect(search('')).toEqual(['saba-misoni', 'mushi-yasai-salad']);
  });
});

describe('検索語の分け方', () => {
  it('空白で分け、空の語は落とす', () => {
    expect(parseQuery('  さば   みそ  ')).toEqual(['さば', 'みそ']);
  });

  it('全角空白でも分かれる', () => {
    expect(parseQuery('さば　みそ')).toEqual(['さば', 'みそ']);
  });

  it('空の入力は語ゼロになる', () => {
    expect(parseQuery('')).toEqual([]);
    expect(parseQuery('   ')).toEqual([]);
  });
});

describe('正規化', () => {
  it('カタカナをひらがなにする', () => {
    expect(normalize('サバ')).toBe('さば');
  });

  it('長音符はそのまま残す', () => {
    expect(normalize('ブロッコリー')).toBe('ぶろっこりー');
  });

  it('全角英数字を半角にする', () => {
    expect(normalize('０４８ＡＢ')).toBe('048ab');
  });

  it('半角カナを全角にしてからひらがなにする', () => {
    expect(normalize('ｻﾊﾞ')).toBe('さば');
  });

  it('漢字は動かさない', () => {
    expect(normalize('味噌')).toBe('味噌');
  });
});

describe('調理方法の組み立て', () => {
  it('自動調理キーと自動メニュー番号を1行にまとめる', () => {
    expect(cookingMethodLines(recipe({ auto_key: '豚の角煮', menu_no: '048' }))).toEqual([
      '豚の角煮（No.048）',
    ]);
  });

  it('自動調理キーだけならそれだけ出す', () => {
    expect(cookingMethodLines(recipe({ auto_key: '豚の角煮' }))).toEqual(['豚の角煮']);
  });

  it('自動メニュー番号だけならそれだけ出す', () => {
    expect(cookingMethodLines(recipe({ menu_no: '048' }))).toEqual(['No.048']);
  });

  it('自動調理キーと手動設定は両方出す', () => {
    expect(cookingMethodLines(recipe({ auto_key: '豚の角煮', manual_note: '追加5分' }))).toEqual([
      '豚の角煮',
      '追加5分',
    ]);
  });

  it('どれも空なら空になる（呼び出し側が区画ごと出さない）', () => {
    expect(cookingMethodLines(recipe({}))).toEqual([]);
  });
});
