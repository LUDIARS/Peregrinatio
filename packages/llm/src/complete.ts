// テキスト補完 (claude CLI 経由)。施設サマリーの構造化抽出などに使う。
import { runClaudeCli } from './cli.js';

export interface CompleteOptions {
  /** system 指示。CLI へは引数長制限回避のため user と結合して stdin で渡す。 */
  system?: string;
  /** ユーザプロンプト本文。 */
  user: string;
  /** モデル (エイリアス or フル ID)。既定 'haiku'。 */
  model?: string;
}

/**
 * claude CLI を 1 回呼んで応答テキストを返す。Anthropic API は使わない (LUDIARS 規約)。
 * system があれば user の前に結合してから stdin で渡す。
 */
export async function complete(opts: CompleteOptions): Promise<string> {
  const prompt = opts.system ? `${opts.system}\n\n${opts.user}` : opts.user;
  return runClaudeCli(prompt, { model: opts.model ?? 'haiku' });
}
