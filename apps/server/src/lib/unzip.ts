// 依存を増やさない最小 ZIP リーダー (node:zlib のみ)。GTFS の zip (stored/deflate) を展開する。
// 中央ディレクトリからサイズ/オフセットを読むので data descriptor 形式でも正しく読める。
// ZIP64 / 暗号化 / deflate64 は未対応 (GTFS-JP の通常 zip では発生しない。検出したら throw)。

import { inflateRawSync } from 'node:zlib';
import { contract } from './contracts/runtime.js'; /* augur-inject:import:8403de33 */
import augurContract_15e298d9 from './contracts/unzip.contract.js'; /* augur-inject:contract-predicate:63e37891 */

// 大きな GTFS-JP の stop_times.txt に余裕を残しつつ、展開爆弾のメモリ確保を制限する。
const MAX_ENTRY_BYTES = 512 * 1024 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

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
function readEntryData(buf: Buffer, e: CentralEntry, budget: number): Buffer {
  if (buf.readUInt32LE(e.localOffset) !== LFH_SIG) {
    throw new Error(`unzip: ローカルヘッダが不正です (${e.name})`);
  }
  const nameLen = buf.readUInt16LE(e.localOffset + 26);
  const extraLen = buf.readUInt16LE(e.localOffset + 28);
  const dataStart = e.localOffset + 30 + nameLen + extraLen;
  const raw = buf.subarray(dataStart, dataStart + e.compressedSize);
  if (e.method === 0) {
    if (raw.length > budget) throw new Error(`unzip: 展開サイズが上限を超えています (${e.name})`);
    return Buffer.from(raw); // stored: コピーによる確保より前に検査する。
  }
  if (e.method === 8) {
    // zlib は 0 を許さない。残り予算 0 のときも空のエントリだけは受理する。
    const data = inflateRawSync(raw, { maxOutputLength: Math.max(1, budget) });
    if (data.length > budget) throw new Error(`unzip: 展開サイズが上限を超えています (${e.name})`);
    return data;
  }
  throw new Error(`unzip: 未対応の圧縮方式 method=${e.method} (${e.name})`);
}

/**
 * ZIP バッファを展開し、ファイル名 → 内容(Buffer) の Map を返す。
 * ディレクトリエントリ (末尾 '/') は除外する。
 */
export function unzip(
  buf: Buffer,
  limits = { entryBytes: MAX_ENTRY_BYTES, totalBytes: MAX_TOTAL_BYTES },
): Map<string, Buffer> {
  // 内部テストでは縮小予算を使う。本番上限の引き上げは許さない。
  if (!Number.isSafeInteger(limits.entryBytes) || limits.entryBytes < 1 || limits.entryBytes > MAX_ENTRY_BYTES
    || !Number.isSafeInteger(limits.totalBytes) || limits.totalBytes < 1 || limits.totalBytes > MAX_TOTAL_BYTES) {
    throw new Error('unzip: 展開サイズの上限が不正です');
  }
  const { cdOffset, cdEntries } = findEocd(buf);
  const entries = readCentralDirectory(buf, cdOffset, cdEntries);
  const out = new Map<string, Buffer>();
  let totalBytes = 0;
  for (const e of entries) {
    if (e.name.endsWith('/')) continue; // ディレクトリ
    if (e.flags & 0x1) throw new Error(`unzip: 暗号化された zip は未対応です (${e.name})`);
    const data = readEntryData(buf, e, Math.min(limits.entryBytes, limits.totalBytes - totalBytes));
    totalBytes += data.length;
    out.set(e.name, data);
  }
  return out;
}
// @ts-expect-error augur-inject
unzip = contract(unzip, { ...augurContract_15e298d9, contractId: 'C-1', mode: 'observe', sample: 1, where: 'apps/server/src/lib/unzip.ts:84', rule: 'contract-wrap', id: '15e298d9' }); /* augur-inject:contract-wrap:15e298d9 */
