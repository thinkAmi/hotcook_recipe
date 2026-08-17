import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.*'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      // ビルドの中核(スプリッタと検証・正規化)だけを測る。CLI の入出力は
      // 手元での実行で確認する。しきい値は実測を見てから決める(design の Open Questions)。
      include: ['scripts/frontmatter.mjs', 'scripts/build-index.mjs'],
    },
  },
});
