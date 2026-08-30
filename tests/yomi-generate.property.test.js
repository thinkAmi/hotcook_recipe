import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { updateYomiTable } from '../scripts/build-yomi.mjs';
import { mergeYomiTable } from '../scripts/yomi-table.mjs';

// 再生成が著者の訂正を壊さないことを、性質として固定する(design D-27 (c))。
//
// 誤読は機械では判定できないため、訂正が静かに消えると誤読が復活したことにも
// 気づけない。「訂正は絶対に変わらない」はこの設計の生命線なので、例ではなく
// 性質として押さえる。

let workDir;
let recipesDir;
let dataDir;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'hotcook-yomi-prop-'));
  recipesDir = join(workDir, 'recipes');
  dataDir = join(workDir, 'data');
  mkdirSync(recipesDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(recipesDir, 'saba-misoni.md'),
    '---\ntitle: サバの味噌煮\ningredients:\n  - 味噌 大さじ2\n---\n手順\n',
  );
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/** 読みの取得を差し替える。生成側の中身を自由に振るための偽物 */
const segmentList = fc.array(
  fc
    .record({
      surface: fc.constantFrom('味噌', '大根', '葱', '米', '生姜', '自家製', '2', 'にんじん'),
      yomi: fc.constantFrom('みそ', 'だいこん', 'き', 'べい', 'しょうが', '', 'にんじん'),
    })
    .map((token) => ({ ...token, tokens: [token] })),
  { maxLength: 10 },
);

/** 著者の訂正。読みを消す(null)ことも書くこともある */
const overridesTable = fc.dictionary(
  fc.constantFrom('葱', '米', '鯖', '自家製', '味噌', '人参'),
  fc.oneof(fc.string({ maxLength: 8 }), fc.constant(null)),
  { maxKeys: 5 },
);

describe('再生成の非破壊性', () => {
  it('自動生成部分をどう作り直しても、訂正のファイルは1バイトも変わらない', () => {
    fc.assert(
      fc.property(overridesTable, segmentList, (overrides, segments) => {
        const overridesFile = join(dataDir, 'yomi.overrides.json');
        const before = `${JSON.stringify(overrides, null, 2)}\n`;
        writeFileSync(overridesFile, before);

        updateYomiTable({
          recipesDir,
          generatedFile: join(dataDir, 'yomi.generated.json'),
          readSegmentsImpl: () => segments,
        });

        expect(readFileSync(overridesFile, 'utf8')).toBe(before);
      }),
    );
  });

  it('何度作り直しても、訂正を重ねた結果は訂正の値を保つ', () => {
    fc.assert(
      fc.property(overridesTable, segmentList, segmentList, (overrides, first, second) => {
        const generatedFile = join(dataDir, 'yomi.generated.json');

        updateYomiTable({ recipesDir, generatedFile, readSegmentsImpl: () => first });
        const afterFirst = mergeYomiTable(
          JSON.parse(readFileSync(generatedFile, 'utf8')),
          overrides,
        );

        updateYomiTable({ recipesDir, generatedFile, readSegmentsImpl: () => second });
        const afterSecond = mergeYomiTable(
          JSON.parse(readFileSync(generatedFile, 'utf8')),
          overrides,
        );

        for (const word of Object.keys(overrides)) {
          expect(afterFirst[word]).toBe(overrides[word]);
          expect(afterSecond[word]).toBe(overrides[word]);
        }
      }),
    );
  });

  it('生成は訂正のファイルが無くても動く', () => {
    const generatedFile = join(dataDir, 'yomi-no-overrides.json');

    const { table } = updateYomiTable({
      recipesDir,
      generatedFile,
      readSegmentsImpl: () => [{ surface: '味噌', yomi: 'みそ', tokens: [] }],
    });

    expect(table).toEqual({ 味噌: 'みそ' });
  });
});
