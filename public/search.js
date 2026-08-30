// 検索の中身。DOM に一切触れない純関数だけを置く(design D-19 帰結・D-27)。
//
// ブラウザからは素の ES モジュールとして読み込み、テストからは Node で直接 import する。
// バンドラは使わない。第三者コードも使わない——日本語で効くのは表記のゆれの吸収であって
// タイポ吸収ではないので、あいまい検索ライブラリを入れても穴は埋まらない(design D-19)。

/** カタカナの範囲(ァ〜ヶ)。長音符(ー)は動かさない */
const KATAKANA = /[ァ-ヶ]/g;

/**
 * 表記のゆれを吸収する(design D-20)。
 *
 * - NFKC: 全角英数字→半角、半角カナ→全角カナ、全角空白→半角空白
 * - カタカナ→ひらがな: 「サバ」と「さば」を同じにする
 * - 小文字化: 英字の大小を無視する
 *
 * 漢字はここでは動かない。漢字とかなの差は正規化では埋まらないので、
 * ビルド時に付けた読み(*_yomi)と突き合わせて吸収する(design D-13)。
 *
 * @param {string} text
 * @returns {string}
 */
export function normalize(text) {
  return String(text)
    .normalize('NFKC')
    .replace(KATAKANA, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .toLowerCase();
}

/**
 * 検索語を空白で分ける(design D-21)。
 *
 * 空白以外の記号は演算子として扱わず、語の一部として残す。覚える記号をゼロにしておくと、
 * スマホのフリック入力でも打ちやすい。演算子は後から足しても既存の打ち方を壊さない。
 *
 * @param {string} query
 * @returns {string[]} 正規化済みの語。空の語は含まない
 */
export function parseQuery(query) {
  return normalize(query)
    .split(/\s+/)
    .filter((term) => term !== '');
}

/**
 * レシピ1件から、検索の対象になるテキストを取り出す(spec「検索の対象」)。
 *
 * 表記そのものと読みを分けて持つ。読みで当たったか表記で当たったかを区別する必要は
 * 無いが、読みを持たない項目(自動メニュー番号・本文・ID)があるので混ぜない。
 *
 * @param {object} recipe 検索インデックスのレシピオブジェクト
 * @returns {{ plain: string, yomi: string }}
 */
export function searchableText(recipe) {
  const plain = [
    recipe.id,
    recipe.title,
    ...recipe.ingredients,
    recipe.auto_key,
    recipe.menu_no,
    recipe.manual_note,
    recipe.body,
  ];
  const yomi = [
    recipe.title_yomi,
    ...(recipe.ingredients_yomi ?? []),
    recipe.auto_key_yomi,
    recipe.manual_note_yomi,
  ];

  // 項目の境目をまたいだ偶然の一致を避けるため、空白でつなぐ
  return {
    plain: normalize(plain.filter(Boolean).join(' ')),
    yomi: normalize(yomi.filter(Boolean).join(' ')),
  };
}

/**
 * 検索できる形に整える。起動時に1回だけ呼ぶ(design D-20)。
 *
 * @param {object[]} recipes 料理名順に並んだレシピ
 * @returns {{ recipe: object, plain: string, yomi: string }[]}
 */
export function prepare(recipes) {
  return recipes.map((recipe) => ({ recipe, ...searchableText(recipe) }));
}

/**
 * 検索語で絞り込む(spec「空白区切りはすべてを含む条件」)。
 *
 * 語をすべて含むレシピだけを返す。語ごとに、表記そのものと読みのどちらかで
 * 一致すればよい。入力の順序は変えないので、並びは料理名順のまま(design D-22)。
 *
 * @param {{ recipe: object, plain: string, yomi: string }[]} prepared
 * @param {string} query
 * @returns {object[]}
 */
export function filterRecipes(prepared, query) {
  const terms = parseQuery(query);
  if (terms.length === 0) return prepared.map((entry) => entry.recipe);

  return prepared
    .filter(({ plain, yomi }) => terms.every((term) => plain.includes(term) || yomi.includes(term)))
    .map((entry) => entry.recipe);
}

/**
 * 詳細に出す調理方法の行を組み立てる(spec「調理方法は値のあるものだけをまとめて表示する」)。
 *
 * 自動調理キーと自動メニュー番号は同じ調理方法を指すので1行にまとめる。
 * どれも空なら空配列を返し、呼び出し側は区画ごと出さない。
 *
 * @param {object} recipe
 * @returns {string[]}
 */
export function cookingMethodLines(recipe) {
  const lines = [];

  const autoKey = recipe.auto_key ?? '';
  const menuNo = recipe.menu_no ?? '';
  if (autoKey !== '' && menuNo !== '') {
    lines.push(`${autoKey}（No.${menuNo}）`);
  } else if (autoKey !== '') {
    lines.push(autoKey);
  } else if (menuNo !== '') {
    lines.push(`No.${menuNo}`);
  }

  if ((recipe.manual_note ?? '') !== '') lines.push(recipe.manual_note);

  return lines;
}
