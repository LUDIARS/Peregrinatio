// 依存を増やさない最小 ZIP リーダー (node:zlib のみ)。GTFS の zip (stored/deflate) を展開する。
// 中央ディレクトリからサイズ/オフセットを読むので data descriptor 形式でも正しく読める。
// ZIP64 / 暗号化 / deflate64 は未対応 (GTFS-JP の通常 zip では発生しない。検出したら throw)。

import { inflateRawSync } from 'node:zlib';

const EOCD_SIG = 0x06054b50; // End Of Central Directory
const CD_SIG = 0x02014b50;   // Central Directory file header
const LFH_SIG = 0x04034b50;  // Local File Header

interface CentralEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
  flags: number;
}

/** 末尾から EOCD を探し、中央ディレクトリの位置とエントリ数を返す。 */
function findEocd(buf: Buffer): { cdOffset: number; cdEntries: number } {
  // コメント長 0〜65535 の範囲で末尾から EOCD シグネチャを探す。
  const minPos = Math.max(0, buf.length - (0xffff + 22));
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      const cdEntries = buf.readUInt16LE(i + 10);
      const cdOffset = buf.readUInt32LE(i + 16);
      if (cdOffset === 0xffffffff) throw new Error('unzip: ZIP64 は未対応です');
      return { cdOffset, cdEntries };
    }
  }
  throw new Error('unzip: ZIP の EOCD が見つかりません (zip ではない/壊れている)');
}

/** 中央ディレクトリを走査してエントリ一覧を返す。 */
function readCentralDirectory(buf: Buffer, cdOffset: number, cdEntries: number): CentralEntry[] {
  const entries: CentralEntry[] = [];
  let p = cdOffset;
  for (let n = 0; n < cdEntries; n++) {
    if (buf.readUInt32LE(p) !== CD_SIG) break;
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, method, compressedSize, localOffset, flags });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** ローカルヘッダからデータ開始位置を求め、エントリの生データを取り出す。 */
function readEntryData(buf: Buffer, e: CentralEntry): Buffer {
  if (buf.readUInt32LE(e.localOffset) !== LFH_SIG) {
    throw new Error(`unzip: ローカルヘッダが不正です (${e.name})`);
  }
  const nameLen = buf.readUInt16LE(e.localOffset + 26);
  const extraLen = buf.readUInt16LE(e.localOffset + 28);
  const dataStart = e.localOffset + 30 + nameLen + extraLen;
  const raw = buf.subarray(dataStart, dataStart + e.compressedSize);
  if (e.method === 0) return Buffer.from(raw); // stored
  if (e.method === 8) return inflateRawSync(raw); // deflate
  throw new Error(`unzip: 未対応の圧縮方式 method=${e.method} (${e.name})`);
}

/**
 * ZIP バッファを展開し、ファイル名 → 内容(Buffer) の Map を返す。
 * ディレクトリエントリ (末尾 '/') は除外する。
 */
export function unzip(buf: Buffer): Map<string, Buffer> {
  const { cdOffset, cdEntries } = findEocd(buf);
  const entries = readCentralDirectory(buf, cdOffset, cdEntries);
  const out = new Map<string, Buffer>();
  for (const e of entries) {
    if (e.name.endsWith('/')) continue; // ディレクトリ
    if (e.flags & 0x1) throw new Error(`unzip: 暗号化された zip は未対応です (${e.name})`);
    out.set(e.name, readEntryData(buf, e));
  }
  return out;
}
