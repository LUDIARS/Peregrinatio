// 画像解析 (vision) を claude CLI 経由で行う。
//
// claude CLI 自体には画像を直接渡すフラグが無いため、print mode で **Read ツール** を許可し
// (`--allowedTools Read`)、画像の **絶対パス** をプロンプト内で参照させて読み取らせる。
// 画像が cwd 外でも読めるよう、画像の置かれたディレクトリを `--add-dir` で許可する。
// 検証済み (spec/setup/llm-vision.md): haiku で Read → 画像内テキスト/住所の抽出に成功。

import { dirname } from 'node:path';
import { runClaudeCli } from './cli.js';

export interface AnalyzeImageOptions {
  /** 解析対象画像の絶対パス。 */
  imagePath: string;
  /** 読み取り後にさせたい指示 (例: 「JSON {analysis, address?} で返す」)。 */
  prompt: string;
  /** モデル (エイリアス or フル ID)。既定 'haiku'。 */
  model?: string;
  /** 中断用シグナル。 */
  signal?: AbortSignal;
}

/**
 * 画像を claude CLI (Read ツール) で解析し、応答テキスト全体を返す。
 * 呼び出し側で JSON 抽出/parse する。CLI 未ログイン等は例外で surface する。
 */
export async function analyzeImage(opts: AnalyzeImageOptions): Promise<string> {
  const instruction = [
    '次の画像ファイルを Read ツールで開いて内容を読み取ってください。',
    `画像の絶対パス: ${opts.imagePath}`,
    '',
    opts.prompt,
  ].join('\n');

  return runClaudeCli(instruction, {
    model: opts.model ?? 'haiku',
    allowedTools: ['Read'],
    addDirs: [dirname(opts.imagePath)],
    signal: opts.signal,
  });
}
