// 読みの対応表を扱う純粋な関数群。
//
// OS 依存なのは読みの取得(yomi-reader.mjs)だけで、ここから先——表の組み立て・訂正の
// 重ね方・最長一致での読み付与・警告の判定——はすべて文字列とデータの関数にする。
// そうすることで、macOS でなくてもビルドとテストが動く(design D-27)。

/** 漢字(Han)を1文字以上含むか */
const HAS_KANJI = /\p{Script=Han}/u;

/**
 * 対応表に載せる語か(design D-17 帰結)。
 *
 * 載せるのは漢字を含む語だけにする。理由は2つある。
 * - 数字・記号・ラテン文字は読みが要らない。載せると「200g → 200ぐ」のようなノイズになる
 * - かな・カナだけの語も要らない。表記の違いはブラウザ側の正規化(カタカナ→ひらがな)で
 *   吸収されるうえ、載せるとかえって害になる。読みはローマ字を経由するため長音が崩れ、
 *   「ブロッコリー」が「ぶろっこりい」になる(実測)。正規化なら「ぶろっこりー」のままで、
 *   そちらが利用者の打ち方に近い
 *
 * @param {string} surface
 */
export function isYomiTarget(surface) {
  return typeof surface === 'string' && HAS_KANJI.test(surface);
}

/**
 * 取得した読みを検証して、対応表に入れる値にする。
 * 読み取れていないものは null にして、あとで警告と訂正の対象にする
 * (spec「読みを取得できなかった語が分かる」)。
 *
 * @returns {string | null} 読み。取得できていなければ null
 */
export function normalizeYomi(yomi) {
  if (typeof yomi !== 'string') return null;
  const trimmed = yomi.trim();
  if (trimmed === '') return null;
  // 漢字が残っているなら変換されていない = 読めていない
  if (HAS_KANJI.test(trimmed)) return null;
  return trimmed;
}

/**
 * 断片の並びから自動生成部分の対応表を組み立てる。
 *
 * 断片そのものと、その中の語の両方を積む。語だけだと、同じ文字列が文脈によって違う
 * 切られ方をしたときに最長一致が取り違える(design D-17 帰結)。
 *
 *   料理名「豚バラ大根」 → 豚バラ / 大根 と切れる  → 表に「豚バラ」
 *   材料「豚バラ肉」     → 豚 / バラ肉  と切れる  → 表に「豚」「バラ肉」（「肉」は入らない）
 *   → 最長一致で「豚バラ」が勝ち、「豚バラ肉」が「ぶたばら肉」になる
 *
 * 断片「豚バラ肉」を積んでおけばこれが最長で勝つので、レシピに実際に現れる表記は
 * 必ず正しく引ける。語のエントリも残すので、語彙はレシピ横断で共有される。
 *
 * 同じ表層が複数回現れたときは、読めたものを優先する(文脈によって読めたり読めなかったり
 * するため)。両方読めた場合は先に現れたものを採る。キーは並べ替えて返すので、同じ入力
 * からは常に同じ表になる(spec「再生成」の再現性)。
 *
 * @param {{ surface: string, yomi: string, tokens?: { surface: string, yomi: string }[] }[]} segments
 * @returns {Record<string, string | null>}
 */
export function buildYomiTable(segments) {
  /** @type {Map<string, string | null>} */
  const table = new Map();

  const add = (surface, yomi) => {
    if (!isYomiTarget(surface)) return;
    const value = normalizeYomi(yomi);
    if (!table.has(surface)) {
      table.set(surface, value);
    } else if (table.get(surface) === null && value !== null) {
      table.set(surface, value);
    }
  };

  for (const segment of segments) {
    add(segment.surface, segment.yomi);
    for (const token of segment.tokens ?? []) add(token.surface, token.yomi);
  }

  const sorted = {};
  for (const surface of [...table.keys()].sort((a, b) => a.localeCompare(b, 'ja'))) {
    sorted[surface] = table.get(surface);
  }
  return sorted;
}

/**
 * 自動生成部分に著者の訂正を重ねる(design D-15)。訂正は必ず勝つ。
 *
 * @param {Record<string, string | null>} generated
 * @param {Record<string, string | null>} overrides
 * @returns {Record<string, string | null>}
 */
export function mergeYomiTable(generated, overrides) {
  return { ...generated, ...overrides };
}

/**
 * 最長一致で引けるように対応表を組み直す(design D-17)。
 * 先頭の1文字で束ね、その中を長い順に並べる。
 *
 * @param {Record<string, string | null>} merged
 * @returns {Map<string, [string, string | null][]>}
 */
export function compileYomiTable(merged) {
  /** @type {Map<string, [string, string | null][]>} */
  const byFirstChar = new Map();

  for (const [surface, yomi] of Object.entries(merged)) {
    if (surface === '') continue;
    const first = String.fromCodePoint(surface.codePointAt(0));
    if (!byFirstChar.has(first)) byFirstChar.set(first, []);
    byFirstChar.get(first).push([surface, yomi]);
  }
  for (const entries of byFirstChar.values()) {
    entries.sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]));
  }
  return byFirstChar;
}

/**
 * テキストを読みに変える(design D-17)。
 *
 * 先頭から最長一致で置換していく。分割器は持たないので、対応表を作ったときの語の
 * 切り方に一切依存しない。表に無い文字はそのまま残す。
 * 読みを取得できなかった語(null)は、その語だけ元の表記のまま残す(design D-18 帰結)。
 *
 * @param {string} text
 * @param {Map<string, [string, string | null][]>} compiled compileYomiTable の返り値
 * @returns {string}
 */
export function toYomi(text, compiled) {
  const source = String(text);
  let out = '';
  let i = 0;

  while (i < source.length) {
    const char = String.fromCodePoint(source.codePointAt(i));
    const candidates = compiled.get(char);

    let hit = null;
    if (candidates) {
      for (const entry of candidates) {
        if (source.startsWith(entry[0], i)) {
          hit = entry;
          break;
        }
      }
    }

    if (hit) {
      const [surface, yomi] = hit;
      out += yomi === null ? surface : yomi;
      i += surface.length;
    } else {
      out += char;
      i += char.length;
    }
  }
  return out;
}

/**
 * 組み立てた読みに漢字が残っているか(design D-28)。
 *
 * 残っていれば対応表に語が足りていないということで、その項目はかなで打っても引けない。
 * 誤読と違ってこれは機械で判定できるので、ビルドの警告に使う。
 *
 * @param {string} yomi
 */
export function hasUnconvertedKanji(yomi) {
  return HAS_KANJI.test(String(yomi));
}

/**
 * 対応表についての警告を集める(design D-15 帰結)。
 *
 * どれもビルドを失敗させない。新しい食材を書くたびにビルドが止まるのは厳しすぎるため。
 * 誤読そのものは機械には判定できない(かなとして妥当な形で出るため)ので、ここで拾えるのは
 * 「読めなかった」「もう要らない」の2種類だけ。誤読は対応表の差分レビューで人が拾う。
 *
 * @param {Record<string, string | null>} generated 自動生成部分(= 現在レシピにある語)
 * @param {Record<string, string | null>} overrides 著者の訂正
 * @returns {{ word: string, message: string }[]}
 */
export function collectYomiWarnings(generated, overrides) {
  const warnings = [];

  // (1) 読めないまま訂正も無い語
  for (const [word, yomi] of Object.entries(generated)) {
    if (yomi === null && !(word in overrides)) {
      warnings.push({
        word,
        message: '読みを取得できていません。かなでは引けないので、訂正に読みを書いてください',
      });
    }
  }

  // (2)(3) もう要らない訂正
  for (const [word, yomi] of Object.entries(overrides)) {
    if (!(word in generated)) {
      warnings.push({ word, message: 'どのレシピにも現れない語の訂正です。削除できます' });
    } else if (generated[word] === yomi) {
      warnings.push({ word, message: '自動生成された読みと同じ値です。削除できます' });
    }
  }

  return warnings;
}
