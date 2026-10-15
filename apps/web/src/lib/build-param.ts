/** ビルド更新時のリロードで URL に付ける版数パラメータ。 */
export const BUILD_PARAM = '_pe_build';

/**
 * `_pe_build` を除いた URL を返す。付いていなければ null (書き換え不要)。
 * 他のクエリ・パス・ハッシュはそのまま残す。
 */
export function stripBuildParam(href: string): string | null {
  const url = new URL(href);
  if (!url.searchParams.has(BUILD_PARAM)) return null;
  url.searchParams.delete(BUILD_PARAM);
  return url.toString();
}
