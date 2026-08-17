import fc from 'fast-check';
import { dump as dumpYaml } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../scripts/frontmatter.mjs';

// スプリッタは切り出しだけを担うので、往復性(結合 → 分割で元に戻る)が性質になる。
// 例に基づくテストでは拾いきれない本文中の `---` や記号の並びをここで潰す(design D-10 (a))。

/** frontmatter の値になりうる1行の文字列。改行と BOM は正規化の対象なので除く */
const lineString = fc
  .string({ minLength: 1, maxLength: 30 })
  .map((s) => s.replace(/[\r\n﻿]/g, ' '))
  .filter((s) => s.trim() !== '');

/** レシピの frontmatter を模したオブジェクト(文字列と文字列リスト) */
const frontmatterObject = fc.record(
  {
    title: lineString,
    ingredients: fc.array(lineString, { minLength: 1, maxLength: 5 }),
    auto_key: lineString,
    menu_no: lineString,
    manual_note: lineString,
  },
  { requiredKeys: ['title', 'ingredients'] },
);

/** 本文。`---` だけの行を含みうる */
const bodyText = fc
  .array(fc.oneof(fc.constant('---'), fc.constant(''), fc.string({ maxLength: 40 })), {
    maxLength: 8,
  })
  .map((lines) => lines.map((l) => l.replace(/[\r\n﻿]/g, ' ')).join('\n'));

describe('parseFrontmatter の往復性', () => {
  it('YAML 化して結合したものを分割すると、元のオブジェクトと本文に戻る', () => {
    fc.assert(
      fc.property(frontmatterObject, bodyText, (data, body) => {
        const raw = `---\n${dumpYaml(data)}---\n${body}`;

        const parsed = parseFrontmatter(raw);

        expect(parsed.data).toEqual(data);
        expect(parsed.content).toBe(body);
      }),
    );
  });

  it('本文がどれだけ `---` を含んでも frontmatter は先頭ブロックだけになる', () => {
    fc.assert(
      fc.property(frontmatterObject, fc.integer({ min: 1, max: 5 }), (data, fenceCount) => {
        const body = Array.from({ length: fenceCount }, () => '---').join('\n本文\n');
        const raw = `---\n${dumpYaml(data)}---\n${body}`;

        const parsed = parseFrontmatter(raw);

        expect(parsed.data).toEqual(data);
        expect(parsed.content).toBe(body);
      }),
    );
  });
});
