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
  const limits = { entryBytes: 64, totalBytes: 128 };

  for (const deflate of [false, true]) {
    it(`${deflate ? 'deflate' : 'stored'}: エントリ上限ちょうどを受理し1バイト超過を拒否する`, () => {
      const data = Buffer.alloc(64, 'x');
      expect(unzip(makeZip([{ name: 'a', data, deflate }]), limits).get('a')).toEqual(data);
      expect(() => unzip(makeZip([{ name: 'a', data: Buffer.alloc(65, 'x'), deflate }]), limits)).toThrow();
    });

    it(`${deflate ? 'deflate' : 'stored'}: 合計上限と残り予算を適用し重複名も加算する`, () => {
      const files = [
        { name: 'a', data: Buffer.alloc(64, 'x'), deflate },
        { name: 'b', data: Buffer.alloc(64, 'y'), deflate },
      ];
      expect(unzip(makeZip(files), limits).size).toBe(2);
      expect(() => unzip(makeZip([...files, { name: 'a', data: Buffer.from('z'), deflate }]), limits)).toThrow();
      expect(() => unzip(makeZip(files), { entryBytes: 64, totalBytes: 127 })).toThrow();
      expect(unzip(makeZip([...files, { name: 'empty', data: Buffer.alloc(0), deflate }]), limits).get('empty')).toEqual(Buffer.alloc(0));
    });
  }

  it('申告した展開サイズが小さくても実際のdeflate出力を制限する', () => {
    const zip = makeZip([{ name: 'bomb', data: Buffer.alloc(65536, 'x'), deflate: true }]);
    zip.writeUInt32LE(1, 22);
    const cdOffset = zip.readUInt32LE(zip.length - 6);
    zip.writeUInt32LE(1, cdOffset + 24);
    expect(() => unzip(zip, limits)).toThrow();
  });

  it('ZIP64・暗号化・未対応方式を引き続き拒否する', () => {
    const zip = makeZip([{ name: 'a', data: Buffer.from('a') }]);
    const zip64 = Buffer.from(zip);
    zip64.writeUInt32LE(0xffffffff, zip64.length - 6);
    expect(() => unzip(zip64)).toThrow('ZIP64');
    const cdOffset = zip.readUInt32LE(zip.length - 6);
    const encrypted = Buffer.from(zip);
    encrypted.writeUInt16LE(1, cdOffset + 8);
    expect(() => unzip(encrypted)).toThrow('暗号化');
    const unsupported = Buffer.from(zip);
    unsupported.writeUInt16LE(9, cdOffset + 10);
    expect(() => unzip(unsupported)).toThrow('未対応の圧縮方式');
  });

  it('本番上限を引き上げる内部引数を拒否する', () => {
    expect(() => unzip(makeZip([]), { entryBytes: 512 * 1024 * 1024 + 1, totalBytes: 1024 * 1024 * 1024 })).toThrow();
  });

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
