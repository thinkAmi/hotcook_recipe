// レシピファイルを「先頭の frontmatter ブロック」と「本文」に分ける純関数。
//
// 切り出しだけを自前で行い、YAML の解析は js-yaml に委ねる(design D-02)。
// 本文中の水平線(---)を frontmatter の終端と誤認しないことが、この関数の主な仕事。

import { load as loadYaml } from 'js-yaml';

/** 単独の `---` 行か(末尾の空白は許す) */
const isFence = (line) => /^---[ \t]*$/.test(line);

/**
 * @param {string} raw レシピファイル全体の文字列
 * @returns {{ data: Record<string, unknown>, content: string }}
 *   data: frontmatter を解析したオブジェクト(空 frontmatter なら空オブジェクト)
 *   content: 終端の `---` 行の次から末尾まで(前後の空白は削らない)
 * @throws {Error} frontmatter が無い / 閉じていない / YAML として壊れている /
 *   「キー: 値」の形でない場合。メッセージは著者向けの日本語。
 */
export function parseFrontmatter(raw) {
  // BOM を除き、改行を LF に正規化してから行に分ける
  const text = String(raw)
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');
  const lines = text.split('\n');

  if (!isFence(lines[0])) {
    throw new Error('frontmatter がありません。ファイルの先頭を "---" で始めてください');
  }

  // 2行目以降で最初に現れる単独の `---` 行が frontmatter の終端。
  // 本文中の水平線はこの探索より後ろにあるため、終端と誤認しない。
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (isFence(lines[i])) {
      close = i;
      break;
    }
  }
  if (close === -1) {
    throw new Error('frontmatter が閉じていません。終わりに "---" の行を置いてください');
  }

  const yamlBlock = lines.slice(1, close).join('\n');
  const content = lines.slice(close + 1).join('\n');

  // js-yaml は空入力で例外を投げるため、先に空を処理する(design D-02)
  if (yamlBlock.trim() === '') {
    return { data: {}, content };
  }

  let data;
  try {
    data = loadYaml(yamlBlock);
  } catch (e) {
    throw new Error(`frontmatter の YAML を解析できません: ${e.message}`);
  }

  if (data == null) {
    return { data: {}, content };
  }
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('frontmatter が「キー: 値」の形式になっていません');
  }

  return { data, content };
}
