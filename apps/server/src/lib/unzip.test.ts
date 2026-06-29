import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { unzip } from './unzip.js';

/** テスト用に最小 ZIP を組む (stored / deflate)。CRC は 0 (リーダは検証しない)。 */
function makeZip(files: { name: string; data: Buffer; deflate?: boolean }[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const stored = f.deflate ? deflateRawSync(f.data) : f.data;
    const method = f.deflate ? 8 : 0;
    const name = Buffer.from(f.name, 'utf8');
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt32LE(stored.length, 18);
    lfh.writeUInt32LE(f.data.length, 22);
    lfh.writeUInt16LE(name.length, 26);
    const localOffset = offset;
    local.push(lfh, name, stored);
    offset += 30 + name.length + stored.length;

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(stored.length, 20);
    cd.writeUInt32LE(f.data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(localOffset, 42);
    central.push(cd, name);
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cdBuf, eocd]);
}

describe('unzip', () => {
  it('stored と deflate を展開できる', () => {
    const zip = makeZip([
      { name: 'stops.txt', data: Buffer.from('stop_id,stop_name\nA,駅前\n', 'utf8') },
      { name: 'stop_times.txt', data: Buffer.from('x'.repeat(2000), 'utf8'), deflate: true },
    ]);
    const out = unzip(zip);
    expect(out.get('stops.txt')!.toString('utf8')).toBe('stop_id,stop_name\nA,駅前\n');
    expect(out.get('stop_times.txt')!.toString('utf8')).toBe('x'.repeat(2000));
  });

  it('サブフォルダ付きでも basename で取り出せる (gtfs-import の pick 側)', () => {
    const zip = makeZip([{ name: 'feed/stops.txt', data: Buffer.from('a', 'utf8') }]);
    const out = unzip(zip);
    expect([...out.keys()][0]).toBe('feed/stops.txt');
  });

  it('zip でないと throw', () => {
    expect(() => unzip(Buffer.from('not a zip'))).toThrow();
  });
});
