import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../scripts/frontmatter.mjs';

describe('parseFrontmatter', () => {
  it('先頭の frontmatter を解析し、本文をそのまま返す', () => {
    const raw = [
      '---',
      'title: 豚バラ大根',
      'ingredients:',
      '  - 大根 1/3本',
      '---',
      '',
      '## 手順',
      '',
      '1. 切る',
    ].join('\n');

    const { data, content } = parseFrontmatter(raw);

    expect(data).toEqual({ title: '豚バラ大根', ingredients: ['大根 1/3本'] });
    expect(content).toBe('\n## 手順\n\n1. 切る');
  });

  it('本文中の水平線を frontmatter の終端と誤認しない', () => {
    const raw = [
      '---',
      'title: サバの味噌煮',
      '---',
      '本文の前半',
      '',
      '---',
      '',
      '本文の後半',
    ].join('\n');

    const { data, content } = parseFrontmatter(raw);

    expect(data).toEqual({ title: 'サバの味噌煮' });
    expect(content).toBe('本文の前半\n\n---\n\n本文の後半');
  });

  it('空の frontmatter は空オブジェクトになる', () => {
    const { data, content } = parseFrontmatter('---\n---\n本文');

    expect(data).toEqual({});
    expect(content).toBe('本文');
  });

  it('本文が無い場合は空文字を返す', () => {
    const { data, content } = parseFrontmatter('---\ntitle: 蒸し野菜\n---\n');

    expect(data).toEqual({ title: '蒸し野菜' });
    expect(content).toBe('');
  });

  it('CRLF を LF に正規化する', () => {
    const raw = '---\r\ntitle: 豚バラ大根\r\n---\r\n本文1\r\n本文2';

    const { data, content } = parseFrontmatter(raw);

    expect(data).toEqual({ title: '豚バラ大根' });
    expect(content).toBe('本文1\n本文2');
  });

  it('先頭の BOM を無視する', () => {
    const { data } = parseFrontmatter('﻿---\ntitle: 豚バラ大根\n---\n本文');

    expect(data).toEqual({ title: '豚バラ大根' });
  });

  it('終端の --- 行の末尾に空白があっても終端として扱う', () => {
    const { data, content } = parseFrontmatter('--- \ntitle: 豚バラ大根\n---  \n本文');

    expect(data).toEqual({ title: '豚バラ大根' });
    expect(content).toBe('本文');
  });

  it('frontmatter が無ければエラーになる', () => {
    expect(() => parseFrontmatter('# 見出しだけの本文\n')).toThrow(/frontmatter がありません/);
  });

  it('frontmatter が閉じていなければエラーになる', () => {
    expect(() => parseFrontmatter('---\ntitle: 豚バラ大根\n本文')).toThrow(/閉じていません/);
  });

  it('YAML として壊れていればエラーになる', () => {
    expect(() => parseFrontmatter('---\ntitle: [壊れた\n---\n本文')).toThrow(
      /YAML を解析できません/,
    );
  });

  it('frontmatter がリスト形ならエラーになる', () => {
    expect(() => parseFrontmatter('---\n- 豚バラ大根\n- サバの味噌煮\n---\n本文')).toThrow(
      /「キー: 値」の形式になっていません/,
    );
  });

  it('frontmatter が単一の値ならエラーになる', () => {
    expect(() => parseFrontmatter('---\n豚バラ大根\n---\n本文')).toThrow(
      /「キー: 値」の形式になっていません/,
    );
  });
});
