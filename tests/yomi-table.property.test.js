import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compileYomiTable, mergeYomiTable, toYomi } from '../scripts/yomi-table.mjs';

// 訂正が必ず勝つことを性質として固定する(design D-27 (b))。
// 誤読を直したのに自動生成の値が採られてしまうと、直したつもりで直っていない状態に
// なる。しかも誤読は機械では判定できないので、例のテストだけでは取りこぼしうる。

/** 語。訂正と自動生成で同じ語彙から引くので、必ず衝突する組み合わせが出る */
const word = fc.constantFrom('味噌', '大根', '葱', '米', '生姜', '豚バラ肉');

/** 読み。読めなかったことを表す null も混ぜる */
const yomiValue = fc.oneof(fc.string({ maxLength: 8 }), fc.constant(null));

const yomiTable = fc.dictionary(word, yomiValue, { maxKeys: 6 });

describe('訂正の重ね方（不変条件）', () => {
  it('訂正のある語では、自動生成側の値によらず必ず訂正の値が採られる', () => {
    fc.assert(
      fc.property(yomiTable, yomiTable, (generated, overrides) => {
        const merged = mergeYomiTable(generated, overrides);

        for (const key of Object.keys(overrides)) {
          expect(merged[key]).toBe(overrides[key]);
        }
      }),
    );
  });

  it('訂正に無い語は自動生成の値がそのまま残る', () => {
    fc.assert(
      fc.property(yomiTable, yomiTable, (generated, overrides) => {
        const merged = mergeYomiTable(generated, overrides);

        for (const key of Object.keys(generated)) {
          if (!(key in overrides)) expect(merged[key]).toBe(generated[key]);
        }
      }),
    );
  });

  it('マージ結果の語は、自動生成と訂正の語をあわせたものになる', () => {
    fc.assert(
      fc.property(yomiTable, yomiTable, (generated, overrides) => {
        const expected = new Set([...Object.keys(generated), ...Object.keys(overrides)]);

        expect(new Set(Object.keys(mergeYomiTable(generated, overrides)))).toEqual(expected);
      }),
    );
  });

  it('訂正を重ねた表で引くと、必ず訂正の読みが使われる', () => {
    fc.assert(
      fc.property(word, fc.string({ maxLength: 8 }), yomiTable, (target, fixed, generated) => {
        const compiled = compileYomiTable(mergeYomiTable(generated, { [target]: fixed }));

        expect(toYomi(target, compiled)).toBe(fixed);
      }),
    );
  });
});

describe('読みの引き方（不変条件）', () => {
  it('表が空なら入力がそのまま返る', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (text) => {
        expect(toYomi(text, compileYomiTable({}))).toBe(text);
      }),
    );
  });

  it('読めなかった語（null）は元の表記のまま残る', () => {
    fc.assert(
      fc.property(word, (target) => {
        expect(toYomi(target, compileYomiTable({ [target]: null }))).toBe(target);
      }),
    );
  });

  it('同じ入力からは常に同じ読みが得られる', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), yomiTable, (text, table) => {
        const compiled = compileYomiTable(table);

        expect(toYomi(text, compiled)).toBe(toYomi(text, compiled));
      }),
    );
  });
});
