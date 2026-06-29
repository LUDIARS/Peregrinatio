import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv.js';

describe('parseCsv', () => {
  it('ヘッダ→レコード', () => {
    const rows = parseCsv('a,b,c\n1,2,3\n4,5,6\n');
    expect(rows).toEqual([
      { a: '1', b: '2', c: '3' },
      { a: '4', b: '5', c: '6' },
    ]);
  });
  it('引用符・カンマ内包・""エスケープ', () => {
    const rows = parseCsv('name,note\n"バス, 1番","a ""b"" c"\n');
    expect(rows[0]).toEqual({ name: 'バス, 1番', note: 'a "b" c' });
  });
  it('引用符内の改行', () => {
    const rows = parseCsv('x,y\n"line1\nline2",z\n');
    expect(rows[0]!['x']).toBe('line1\nline2');
    expect(rows.length).toBe(1);
  });
  it('BOM 除去 / 空行スキップ', () => {
    const rows = parseCsv('﻿a,b\n1,2\n\n3,4\n');
    expect(rows).toEqual([{ a: '1', b: '2' }, { a: '3', b: '4' }]);
  });
});
