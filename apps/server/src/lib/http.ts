/** body から許可キーだけを抜き出す (undefined は除外、null は通す)。PATCH のマージ用。 */
export function pick<T extends object>(o: unknown, keys: readonly string[]): Partial<T> {
  const out: Record<string, unknown> = {};
  if (o && typeof o === 'object') {
    const rec = o as Record<string, unknown>;
    for (const k of keys) if (k in rec && rec[k] !== undefined) out[k] = rec[k];
  }
  return out as Partial<T>;
}
