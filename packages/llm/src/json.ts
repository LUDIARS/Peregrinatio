// LLM 出力テキストから JSON オブジェクト部分を取り出す純関数 (Tirocinium evaluator.ts 踏襲)。
// 見つからなければ例外。parse 自体は呼び出し側で行う。

/** ```json ... ``` フェンス優先、無ければ最初の { 〜 最後の } を切り出す。 */
export function extractJsonBlock(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('no JSON object found in LLM output');
  }
  return text.slice(start, end + 1);
}
