/** body から許可キーだけを抜き出す (undefined は除外、null は通す)。PATCH のマージ用。 */
export function pick<T extends object>(o: unknown, keys: readonly string[]): Partial<T> {
  const out: Record<string, unknown> = {};
  if (o && typeof o === 'object') {
    const rec = o as Record<string, unknown>;
    for (const k of keys) if (k in rec && rec[k] !== undefined) out[k] = rec[k];
  }
  return out as Partial<T>;
}

/** リクエストの x-pe-user ヘッダ (複数人編集の表示名) を取り出す。最大8文字。未指定は null。 */
export function userOf(c: { req: { header: (name: string) => string | undefined } }): string | null {
  const raw = c.req.header('x-pe-user');
  if (!raw) return null;
  let name: string;
  try { name = decodeURIComponent(raw); } catch { name = raw; }
  name = name.trim().slice(0, 8);
  return name || null;
}
