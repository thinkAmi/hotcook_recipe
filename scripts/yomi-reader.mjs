// 語の読みを取得する、唯一の OS 依存部分(design D-14)。
//
// 読みを返せるのは読み付き辞書を持った形態素解析器だけだが、辞書は数MB〜数十MB あって
// 依存として重い。macOS 組み込みの日本語エンジンは追加インストールも辞書も要らず、
// しかも著者が日本語を打つときの変換エンジンと同一なので「自分が打つ読み」と一致する。
//
// このモジュールを差し替えれば他は変えずに別のエンジンへ移れる(D-14 見直し条件)。
// 読みの取得以外(表のマージ・最長一致・警告の判定)はすべて yomi-table.mjs に置き、
// OS に依存させない。そうすることで、macOS でなくてもビルドとテストが動く(D-27)。

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const JXA_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'yomi-reader.jxa');

/**
 * 読みを取得する手段が使えないことを表す。
 * これを受けた側は対応表を1バイトも書き換えてはいけない(spec「生成に失敗したときは
 * 対応表を変更しない」)。空の対応表で上書きすると訂正ごと失われ、しかも誤読は
 * 自動検出できないので気づけないまま検索が壊れる。
 */
export class YomiUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'YomiUnavailableError';
  }
}

/** 読みを取得できる環境か(呼び出し側が事前に分岐したいとき用) */
export function isYomiReaderAvailable() {
  return process.platform === 'darwin';
}

/**
 * テキスト群を空白で区切り、断片ごとに「断片全体の読み」と「語ごとの読み」を返す。
 *
 * 空白を含む文字列をそのまま渡すと日本語ではなく中国語として読まれるため
 * (実測: 「生姜 1片」→「しぇえんぐじああんぐ1ぴあ̀ん」)、空白で区切ってから
 * 断片ごとに渡す。区切れば正しく「しょうが 1へん」になる。
 *
 * 断片全体の読みも返すのは、語だけを対応表に積むと最長一致が取り違えるため
 * (「豚バラ肉」が「ぶたばら肉」になる。design D-17 の帰結を参照)。
 *
 * @param {string[]} texts 料理名や材料など、そのままの表記
 * @returns {{ surface: string, yomi: string, tokens: { surface: string, yomi: string }[] }[]}
 * @throws {YomiUnavailableError} 読みを取得できない環境、または取得に失敗した場合
 */
export function readSegments(texts) {
  if (!isYomiReaderAvailable()) {
    throw new YomiUnavailableError(
      `読みを取得できる環境ではありません(macOS が必要です。現在: ${process.platform})`,
    );
  }

  // 空白で区切ってから渡す(中国語との誤判定を避ける)
  const segments = texts.flatMap((text) =>
    String(text)
      .split(/\s+/)
      .filter((s) => s !== ''),
  );
  if (segments.length === 0) return [];

  const workDir = mkdtempSync(join(tmpdir(), 'hotcook-yomi-'));
  try {
    const inputFile = join(workDir, 'segments.json');
    writeFileSync(inputFile, JSON.stringify(segments));

    const result = spawnSync('osascript', ['-l', 'JavaScript', JXA_SCRIPT, inputFile], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });

    if (result.error) {
      throw new YomiUnavailableError(`osascript を起動できません: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new YomiUnavailableError(
        `読みの取得に失敗しました: ${(result.stderr || '').trim() || `終了コード ${result.status}`}`,
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch (e) {
      throw new YomiUnavailableError(`読みの取得結果を解析できません: ${e.message}`);
    }
    if (!Array.isArray(parsed) || parsed.length !== segments.length) {
      throw new YomiUnavailableError('読みの取得結果が入力と対応していません');
    }

    return parsed.map((rawTokens, i) => {
      const tokens = rawTokens.map(([surface, yomi]) => ({ surface, yomi }));
      return {
        surface: segments[i],
        // 読めなかった語は表層のまま残す。落とすと断片の読みから語ごと消えてしまい、
        // 「読めていない」ことが分からなくなる
        yomi: tokens.map((t) => (t.yomi === '' ? t.surface : t.yomi)).join(''),
        tokens,
      };
    });
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
