import fc from 'fast-check';
import { dump as dumpYaml } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { buildRecipes, RECIPE_KEYS } from '../scripts/build-index.mjs';

// 正規化とレンダラの「どんな入力でも崩れない」性質を固定する(design D-10 (b)(c))。
// 例に基づくテストは代表値しか踏まないので、記号や空白の並びはここで潰す。

/** frontmatter の1行の値。改行と BOM は正規化の対象なので除く */
const lineString = fc.string({ minLength: 1, maxLength: 30 }).map((s) => s.replace(/[\r\n﻿]/g, ' '));

/** 空白だけ・空文字も混ざる材料の並び。少なくとも1つは中身がある */
const ingredientList = fc
  .array(fc.oneof(lineString, fc.constant(''), fc.constant('   ')), { maxLength: 5 })
  .chain((rest) => lineString.filter((s) => s.trim() !== '').map((head) => [head, ...rest]));

/** 有効なレシピ1件分の frontmatter（任意項目は有無がばらつく） */
const validFrontmatter = fc.record(
  {
    title: lineString.filter((s) => s.trim() !== ''),
    ingredients: ingredientList,
    auto_key: lineString,
    menu_no: lineString,
    manual_note: lineString,
  },
  { requiredKeys: ['title', 'ingredients'] },
);

/** レシピファイル群（スラッグは一意にする） */
const recipeEntries = fc.array(fc.tuple(validFrontmatter, fc.string({ maxLength: 40 })), {
  minLength: 1,
  maxLength: 6,
});

/** frontmatter と本文からレシピファイルの中身を組み立てる */
function toEntries(pairs) {
  return pairs.map(([data, body], i) => ({
    file: `recipe-${i}.md`,
    slug: `recipe-${i}`,
    raw: `---\n${dumpYaml(data)}---\n${body.replace(/﻿/g, '')}`,
  }));
}

describe('検索インデックスの正規化（不変条件）', () => {
  it('有効なレシピからは不備が出ず、常に決められた8キーを持つ', () => {
    fc.assert(
      fc.property(recipeEntries, (pairs) => {
        const { recipes, issues } = buildRecipes(toEntries(pairs));

        expect(issues).toEqual([]);
        expect(recipes).toHaveLength(pairs.length);
        for (const recipe of recipes) {
          expect(Object.keys(recipe)).toEqual(RECIPE_KEYS);
        }
      }),
    );
  });

  it('任意項目は必ず文字列で、材料に空要素も前後の空白も残らない', () => {
    fc.assert(
      fc.property(recipeEntries, (pairs) => {
        const { recipes } = buildRecipes(toEntries(pairs));

        for (const recipe of recipes) {
          for (const key of ['auto_key', 'menu_no', 'manual_note', 'body', 'body_html']) {
            expect(typeof recipe[key]).toBe('string');
          }
          expect(recipe.ingredients.length).toBeGreaterThan(0);
          for (const ingredient of recipe.ingredients) {
            expect(ingredient).not.toBe('');
            expect(ingredient).toBe(ingredient.trim());
          }
        }
      }),
    );
  });

  it('常に料理名の昇順に並ぶ', () => {
    fc.assert(
      fc.property(recipeEntries, (pairs) => {
        const { recipes } = buildRecipes(toEntries(pairs));

        for (let i = 1; i < recipes.length; i++) {
          expect(recipes[i - 1].title.localeCompare(recipes[i].title, 'ja')).toBeLessThanOrEqual(0);
        }
      }),
    );
  });

  it('同じ入力を2回処理すると同一の結果になる', () => {
    fc.assert(
      fc.property(recipeEntries, (pairs) => {
        const entries = toEntries(pairs);

        const first = buildRecipes(entries).recipes;
        const second = buildRecipes(entries).recipes;

        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      }),
    );
  });
});

describe('本文の変換（レンダラ契約）', () => {
  it('どんな本文でも body_html に生の <script が現れず、変換が例外を投げない', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (body) => {
        const entries = [
          {
            file: 'a.md',
            slug: 'a',
            raw: `---\ntitle: レシピ\ningredients:\n  - 大根\n---\n${body.replace(/﻿/g, '')}`,
          },
        ];

        const { recipes, issues } = buildRecipes(entries);

        expect(issues).toEqual([]);
        expect(recipes[0].body_html).not.toContain('<script');
        expect(recipes[0].body_html.toLowerCase()).not.toContain('<script');
      }),
    );
  });

  it('生 HTML を含む本文でもタグとして出力されない', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('script', 'img', 'iframe', 'b', 'style'),
        lineString,
        (tag, text) => {
          const body = `<${tag}>${text}</${tag}>`;
          const entries = [
            {
              file: 'a.md',
              slug: 'a',
              raw: `---\ntitle: レシピ\ningredients:\n  - 大根\n---\n${body}`,
            },
          ];

          const { recipes } = buildRecipes(entries);

          expect(recipes[0].body_html).not.toContain(`<${tag}>`);
          expect(recipes[0].body_html).toContain(`&lt;${tag}&gt;`);
        },
      ),
    );
  });
});
