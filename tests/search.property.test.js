import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { filterRecipes, normalize, parseQuery, prepare } from '../public/search.js';

// 正規化はブラウザ起動時に1回だけ走り、以降の一致判定すべての土台になる(design D-20)。
// ここが入力によって崩れると検索が静かに当たらなくなるので、性質で固定する(D-27 (a))。

describe('正規化の冪等性', () => {
  it('2回かけても1回かけた結果と等しい', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (text) => {
        expect(normalize(normalize(text))).toBe(normalize(text));
      }),
    );
  });

  it('日本語を含む文字列でも冪等', () => {
    fc.assert(
      fc.property(
        fc.string({
          unit: fc.constantFrom(...'さばサバ味噌大根ｻﾊﾞーッ０４８AbC 　/1-'.split('')),
          maxLength: 40,
        }),
        (text) => {
          expect(normalize(normalize(text))).toBe(normalize(text));
        },
      ),
    );
  });

  it('正規化した文字列にカタカナは残らない', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (text) => {
        expect(normalize(text)).not.toMatch(/[ァ-ヶ]/);
      }),
    );
  });
});

describe('絞り込みの不変条件', () => {
  const recipeArb = fc
    .record({
      id: fc.string({ minLength: 1, maxLength: 12 }),
      title: fc.string({ minLength: 1, maxLength: 20 }),
      ingredients: fc.array(fc.string({ maxLength: 20 }), { maxLength: 4 }),
    })
    .map((r) => ({
      ...r,
      title_yomi: r.title,
      ingredients_yomi: r.ingredients,
      auto_key: '',
      auto_key_yomi: '',
      menu_no: '',
      manual_note: '',
      manual_note_yomi: '',
      body: '',
      body_html: '',
    }));

  const recipeList = fc.array(recipeArb, { maxLength: 6 });

  it('入力が空なら全件が返る', () => {
    fc.assert(
      fc.property(recipeList, (recipes) => {
        expect(filterRecipes(prepare(recipes), '')).toHaveLength(recipes.length);
      }),
    );
  });

  it('結果は必ず入力の部分集合で、並びも入力のまま', () => {
    fc.assert(
      fc.property(recipeList, fc.string({ maxLength: 12 }), (recipes, query) => {
        const matched = filterRecipes(prepare(recipes), query);
        const order = recipes.map((r) => r.id);

        expect(matched.length).toBeLessThanOrEqual(recipes.length);
        // 入力での出現順が保たれている（並べ替えをしない。design D-22）
        const positions = matched.map((r) => order.indexOf(r.id));
        expect([...positions].sort((a, b) => a - b)).toEqual(positions);
      }),
    );
  });

  it('語を増やすと結果は増えない（AND なので単調に狭まる）', () => {
    fc.assert(
      fc.property(
        recipeList,
        fc.string({ maxLength: 8 }),
        fc.string({ maxLength: 8 }),
        (recipes, a, b) => {
          const entries = prepare(recipes);
          // 語がゼロになる入力では「全件」に戻るので、語がある場合だけを見る
          fc.pre(parseQuery(a).length > 0 && parseQuery(b).length > 0);

          const narrowed = filterRecipes(entries, `${a} ${b}`);
          expect(narrowed.length).toBeLessThanOrEqual(filterRecipes(entries, a).length);
        },
      ),
    );
  });
});
