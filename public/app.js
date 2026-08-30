// 画面の組み立てと出来事の受け取り。検索そのものは search.js の純関数に任せる(design D-27)。
//
// 状態の置き場所は URL に統一する。詳細の開閉は「#」に続くレシピの ID が唯一の起点で
// (design D-26)、検索語はクエリパラメータに置く(design D-23)。ダイアログの開閉を URL と
// 別に持つと両者がずれるので、開くのも閉じるのも URL を変えることだけで表す。

import { cookingMethodLines, filterRecipes, prepare } from './search.js';

const INDEX_URL = './recipes.json';

const queryInput = document.getElementById('query');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const dialog = document.getElementById('detail');
const closeButton = document.getElementById('close');
const detailBody = document.querySelector('.detail__body');
const detailTitle = document.getElementById('detail-title');
const detailMethodSection = document.getElementById('detail-method');
const detailMethodList = document.getElementById('detail-method-list');
const detailIngredients = document.getElementById('detail-ingredients');
const detailStepsSection = document.getElementById('detail-steps-section');
const detailSteps = document.getElementById('detail-steps');

/** @type {{ recipe: object, plain: string, yomi: string }[]} */
let prepared = [];
/** @type {Map<string, object>} */
let byId = new Map();
/** 読み込みに失敗しているあいだは true。0件の表示と区別する(spec) */
let loadFailed = false;
/** 日本語入力の変換中は結果を更新しない(design D-24) */
let composing = false;
/** 一覧から開いたか。閉じるときに履歴を戻せるかの判断に使う(design D-26 帰結) */
let openedFromList = false;

// --- 一覧 -------------------------------------------------------------------

function render() {
  if (loadFailed) return;

  const query = queryInput.value;
  const matched = filterRecipes(prepared, query);

  resultsEl.replaceChildren(
    ...matched.map((recipe) => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.className = 'card';
      link.href = `#${encodeURIComponent(recipe.id)}`;
      // カードに出すのは料理名だけ。探している段階では料理名で足りる(design D-25)
      link.textContent = recipe.title;
      link.addEventListener('click', () => {
        openedFromList = true;
      });
      item.append(link);
      return item;
    }),
  );

  if (matched.length === 0) {
    statusEl.textContent = `「${query.trim()}」に一致するレシピがありません。入力を消すと全件に戻ります。`;
  } else {
    statusEl.textContent = '';
  }
}

/** 検索語を URL に反映する。履歴は積まず、「#」に続く部分は保つ(design D-23 の3ルール) */
function syncQueryParam() {
  const query = queryInput.value.trim();
  const url = query
    ? `${location.pathname}?q=${encodeURIComponent(query)}${location.hash}`
    : `${location.pathname}${location.hash}`;
  history.replaceState(null, '', url);
}

function runSearch() {
  render();
  syncQueryParam();
}

// --- 詳細 -------------------------------------------------------------------

function fillDetail(recipe) {
  detailTitle.textContent = recipe.title;

  const methods = cookingMethodLines(recipe);
  // 調理方法がどれも空なら区画ごと出さない(spec)
  detailMethodSection.hidden = methods.length === 0;
  detailMethodList.replaceChildren(
    ...methods.map((line) => {
      const li = document.createElement('li');
      li.textContent = line;
      return li;
    }),
  );

  detailIngredients.replaceChildren(
    ...recipe.ingredients.map((ingredient) => {
      const li = document.createElement('li');
      li.textContent = ingredient;
      return li;
    }),
  );

  detailStepsSection.hidden = recipe.body_html === '';
  // 生 HTML はビルド時に無効化済みなので、そのまま挿入してよい(design D-03)
  detailSteps.innerHTML = recipe.body_html;
}

/** URL の「#」を見てダイアログを開閉する。開閉を決めるのはここだけ(design D-26) */
function syncDialogFromUrl() {
  const id = decodeURIComponent(location.hash.slice(1));
  const recipe = id === '' ? undefined : byId.get(id);

  if (recipe) {
    fillDetail(recipe);
    if (!dialog.open) dialog.showModal();
    // 別のレシピに切り替えたときも先頭から読ませる
    detailBody.scrollTop = 0;
    return;
  }

  // どのレシピにも一致しない ID は開かず、一覧を見せる(spec)
  if (dialog.open) {
    // 閉じる「前」に先頭へ戻す。
    // ブラウザは開き直したときに前回のスクロール位置を復元するので、ここで 0 に
    // しておかないと、次に開いたとき料理名が隠れた状態で始まる。
    // 閉じたあとでは描画されなくなり、scrollTop への代入が効かない。
    detailBody.scrollTop = 0;
    dialog.close();
  }
  openedFromList = false;
}

/** 閉じる操作。開閉の起点は URL なので、ここでも URL を変えることで閉じる */
function requestClose() {
  if (openedFromList) {
    history.back();
    return;
  }
  // ID を含む URL で直接開いた場合は戻り先が無いので、履歴を置き換えて「#」を落とす
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  syncDialogFromUrl();
}

// --- 出来事 -----------------------------------------------------------------

queryInput.addEventListener('compositionstart', () => {
  composing = true;
});
queryInput.addEventListener('compositionend', () => {
  composing = false;
  runSearch();
});
queryInput.addEventListener('input', () => {
  if (!composing) runSearch();
});

// Esc は既定だとダイアログを直接閉じてしまい、URL と食い違う。URL 経由に寄せる
dialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  requestClose();
});
// ダイアログの外側（背景）を選んだとき
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) requestClose();
});
closeButton.addEventListener('click', requestClose);

// 「戻る」「進む」も含め、URL の変化はすべてここで受ける。
// 検索語は読み直さない——進んだ先に古い語が残っていると入力欄が勝手に書き換わる(design D-23)
window.addEventListener('hashchange', syncDialogFromUrl);

// --- 起動 -------------------------------------------------------------------

async function start() {
  // 検索語を読むのは画面を開いたときだけ(design D-23 の3ルール)
  queryInput.value = new URLSearchParams(location.search).get('q') ?? '';

  let recipes;
  try {
    const response = await fetch(INDEX_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    recipes = await response.json();
  } catch (e) {
    loadFailed = true;
    statusEl.textContent = `レシピを読み込めませんでした（${e.message}）。読み込み直してください。`;
    return;
  }

  prepared = prepare(recipes);
  byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));

  render();
  syncDialogFromUrl();
}

start();
