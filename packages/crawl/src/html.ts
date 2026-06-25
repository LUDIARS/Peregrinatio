// HTML → 抽出 LLM に渡すプレーンテキスト化 (Tirocinium companies/html.ts 踏襲)。
// 任意サイトが対象のため汎用 strip に徹する。

const BLOCK_TAGS = /<\/(p|div|section|article|li|tr|h[1-6]|header|footer|main|nav)>/gi;

/** title 要素を抜き出す (要約のヒント / name fallback)。 */
export function extractTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? decodeEntities(m[1]!).trim() : '';
}

/** meta description を抜き出す。 */
export function extractMetaDescription(html: string): string {
  const m =
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html) ??
    /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i.exec(html);
  return m ? decodeEntities(m[1]!).trim() : '';
}

/**
 * HTML から可視テキストを抽出する。
 * - script / style / noscript / svg / template は丸ごと除去
 * - ブロック終了タグ / <br> を改行に変換して段落感を残す
 * - 連続空白 / 空行を畳む
 * maxChars で末尾を切り、LLM のトークンを節約する。
 */
export function htmlToText(html: string, maxChars = 8000): string {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(BLOCK_TAGS, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  s = s.replace(/[ \t　]+/g, ' ');
  s = s.replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n');
  s = s.trim();
  return s.length > maxChars ? s.slice(0, maxChars) : s;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

/** 主要な HTML エンティティと数値参照をデコードする。 */
export function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}
