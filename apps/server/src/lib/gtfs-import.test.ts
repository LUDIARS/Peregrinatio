// importGtfsFromUrl の全経路 (取得→unzip→CSV→保存) を、合成 GTFS zip の data: URL で検証する。
// ネットワーク不要。data: URL は undici fetch が解決する。

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
beforeEach(async () => {
  for (const t of ['gtfs_stop_times', 'gtfs_trips', 'gtfs_routes', 'gtfs_stops', 'gtfs_calendar', 'gtfs_calendar_dates', 'gtfs_feeds']) {
    await sql.unsafe(`DELETE FROM ${t}`);
  }
});

describe('importGtfsFromUrl', () => {
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
