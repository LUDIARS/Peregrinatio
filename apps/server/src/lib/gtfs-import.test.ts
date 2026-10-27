// importGtfsFromUrl の全経路 (取得→unzip→CSV→保存) を、合成 GTFS zip の data: URL で検証する。
// ネットワーク不要。data: URL は undici fetch が解決する。

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { setupTestDb, teardownTestDb } from '../test/db.js';
import { sql } from '../db/index.js';
import { importGtfsFromUrl } from './gtfs-import.js';
import { stopDepartures } from './gtfs-query.js';

function makeZip(files: { name: string; data: string }[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const raw = Buffer.from(f.data, 'utf8');
    const comp = deflateRawSync(raw);
    const name = Buffer.from(f.name, 'utf8');
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(8, 8);
    lfh.writeUInt32LE(comp.length, 18);
    lfh.writeUInt32LE(raw.length, 22);
    lfh.writeUInt16LE(name.length, 26);
    const localOffset = offset;
    local.push(lfh, name, comp);
    offset += 30 + name.length + comp.length;
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(raw.length, 24);
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

const GTFS = [
  { name: 'agency.txt', data: 'agency_id,agency_name\nA,テスト交通\n' },
  { name: 'stops.txt', data: 'stop_id,stop_name,stop_lat,stop_lon\nS1,駅前,35.681,139.767\n' },
  { name: 'routes.txt', data: 'route_id,route_short_name,route_long_name,route_type\nR1,1番,循環,3\n' },
  { name: 'trips.txt', data: 'route_id,service_id,trip_id,trip_headsign\nR1,WD,T1,病院前\n' },
  { name: 'stop_times.txt', data: 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1,09:00:00,09:00:00,S1,1\n' },
  { name: 'calendar.txt', data: 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWD,1,1,1,1,1,1,1,20260101,20261231\n' },
];

beforeAll(async () => { await setupTestDb(); });
afterAll(async () => { await teardownTestDb(); });
afterEach(() => { vi.unstubAllGlobals(); });
beforeEach(async () => {
  for (const t of ['gtfs_stop_times', 'gtfs_trips', 'gtfs_routes', 'gtfs_stops', 'gtfs_calendar', 'gtfs_calendar_dates', 'gtfs_feeds']) {
    await sql.unsafe(`DELETE FROM ${t}`);
  }
});

describe('importGtfsFromUrl', () => {
  const maxBytes = 80 * 1024 * 1024;

  it('Content-Lengthが超過なら読まずにキャンセルし既存のエラーを返す', async () => {
    const cancel = vi.fn(() => { throw new Error('cancel failed'); });
    const body = new ReadableStream<Uint8Array>({ cancel });
    const res = new Response(body, { headers: { 'content-length': String(maxBytes + 1) } });
    vi.stubGlobal('fetch', vi.fn(async () => res));
    await expect(importGtfsFromUrl('https://example.test/feed.zip')).rejects.toThrow('GTFS zip が大きすぎます (80MB > 80MB 上限)');
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  for (const declared of [undefined, '1']) {
    it(`Content-Length=${declared ?? 'なし'}でも受信量の超過で打ち切る`, async () => {
      let pulls = 0;
      const cancel = vi.fn();
      const chunk = new Uint8Array(1024 * 1024);
      const body = new ReadableStream<Uint8Array>({
        pull(controller) { pulls++; controller.enqueue(chunk); },
        cancel,
      }, { highWaterMark: 0 });
      const res = new Response(body, { headers: declared ? { 'content-length': declared } : {} });
      vi.stubGlobal('fetch', vi.fn(async () => res));
      await expect(importGtfsFromUrl('https://example.test/feed.zip')).rejects.toThrow('GTFS zip が大きすぎます (81MB > 80MB 上限)');
      expect(pulls).toBe(81);
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
      expect(await sql.unsafe('SELECT id FROM gtfs_feeds')).toHaveLength(0);
    });
  }

  it('80MiBちょうどの正常ZIPを受理しreaderを解放する', async () => {
    const zip = makeZip(GTFS);
    // 先頭パディングで受信境界を作る。中央ディレクトリとローカル位置も補正する。
    const padding = maxBytes - zip.length;
    const cdOffset = zip.readUInt32LE(zip.length - 6);
    let p = cdOffset;
    for (const file of GTFS) {
      zip.writeUInt32LE(zip.readUInt32LE(p + 42) + padding, p + 42);
      p += 46 + Buffer.byteLength(file.name);
    }
    zip.writeUInt32LE(cdOffset + padding, zip.length - 6);
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(Buffer.alloc(padding)); controller.enqueue(zip); controller.close(); },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'content-length': String(maxBytes) } })));
    expect((await importGtfsFromUrl('https://example.test/feed.zip')).stop_count).toBe(1);
    expect(body.locked).toBe(false);
  });

  it('読取失敗でもreaderを解放し元の例外を保つ', async () => {
    const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.error(new Error('read failed')); } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    await expect(importGtfsFromUrl('https://example.test/feed.zip')).rejects.toThrow('read failed');
    expect(body.locked).toBe(false);
  });

  it('ZIPの展開エラーは既存の取込エラー経路に乗る', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not a zip')));
    await expect(importGtfsFromUrl('https://example.test/feed.zip')).rejects.toThrow('GTFS zip を展開できませんでした:');
  });

  it('data: URL の GTFS zip を取り込み、停留所の発車を引ける', async () => {
    const zip = makeZip(GTFS);
    const dataUrl = `data:application/zip;base64,${zip.toString('base64')}`;
    const feed = await importGtfsFromUrl(dataUrl, 'テスト交通');
    expect(feed.name).toBe('テスト交通');
    expect(feed.stop_count).toBe(1);
    expect(feed.trip_count).toBe(1);

    const deps = await stopDepartures(feed.id, 'S1', '20260629', '08:00:00', 5);
    expect(deps.map((d) => d.departure_time)).toEqual(['09:00:00']);
    expect(deps[0]!.route_name).toBe('1番');
    expect(deps[0]!.headsign).toBe('病院前');
  });
});
