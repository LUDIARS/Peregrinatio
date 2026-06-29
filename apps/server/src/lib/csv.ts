// 最小 CSV パーサ (GTFS 用)。RFC4180 風: ダブルクォート囲み・"" エスケープ・改行/カンマ内包に対応。
// 先頭行をヘッダとし、各行をヘッダ名→値のオブジェクトにする。先頭 BOM は除去する。

/** CSV テキストを行(セル配列)の配列にする。 */
function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  // 先頭 BOM 除去。
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } // "" → "
        else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') { continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  // 最終フィールド/行 (末尾改行が無い場合)。
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/** CSV テキストをヘッダ名→値のレコード配列にする。空行は無視。 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseRows(text);
  if (rows.length === 0) return [];
  const header = rows[0]!.map((h) => h.trim());
  const out: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]!;
    // 完全な空行 (セル1個で空) はスキップ。
    if (cells.length === 1 && cells[0] === '') continue;
    const rec: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) rec[header[c]!] = cells[c] ?? '';
    out.push(rec);
  }
  return out;
}
