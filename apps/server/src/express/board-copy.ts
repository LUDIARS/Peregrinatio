// ライブラリの便を旅の区間ボード (timetables / timetable_departures) へ写す。
// しおりの「移動を追加」で便を採用したときだけ呼ぶ書き込み。同じ便を 2 度写しても 1 行にまとめる。
// @implements SPEC-EXPRESS-ITINERARY

import { sql } from '../db/index.js';
import { newId } from '../lib/ids.js';
import type { Timetable, TimetableDeparture, TimetableKind } from '../types.js';
import { getExpressLine, listStations, listTrains } from './repository.js';
import type { ExpressLineKind } from './types.js';

const BOARD_KIND: Record<ExpressLineKind, TimetableKind> = { shinkansen: 'shinkansen', limited_express: 'train' };

export type BoardCopyResult =
  | { ok: true; timetable: Timetable; departure: TimetableDeparture }
  | { ok: false; status: 404 | 400; error: string };

async function ensureBoard(tripId: string, kind: TimetableKind, lineName: string, from: string, to: string, notes: string): Promise<Timetable> {
  const [existing] = (await sql`
    SELECT * FROM timetables
    WHERE trip_id=${tripId} AND kind=${kind} AND line_name=${lineName} AND from_station=${from} AND to_station=${to}
    ORDER BY created_at LIMIT 1`) as Timetable[];
  if (existing) return existing;
  const id = newId();
  await sql`INSERT INTO timetables (id, trip_id, kind, line_name, from_station, to_station, notes)
    VALUES (${id}, ${tripId}, ${kind}, ${lineName}, ${from}, ${to}, ${notes})`;
  const [created] = (await sql`SELECT * FROM timetables WHERE id=${id}`) as Timetable[];
  if (!created) throw new Error('timetable insert failed');
  return created;
}

export async function copyTrainToBoard(
  tripId: string,
  trainId: string,
  fromSeq: number,
  toSeq: number,
): Promise<BoardCopyResult> {
  const [trip] = (await sql`SELECT id FROM trips WHERE id=${tripId}`) as { id: string }[];
  if (!trip) return { ok: false, status: 404, error: '旅が見つかりません' };
  const [row] = (await sql`SELECT line_id FROM express_trains WHERE id=${trainId}`) as { line_id: string }[];
  if (!row) return { ok: false, status: 404, error: '列車が見つかりません' };
  const line = await getExpressLine(row.line_id);
  if (!line) return { ok: false, status: 404, error: '路線が見つかりません' };

  const train = (await listTrains(line.id)).find((t) => t.id === trainId);
  const stations = await listStations(line.id);
  const from = stations.find((s) => s.seq === fromSeq);
  const to = stations.find((s) => s.seq === toSeq);
  const board = train?.stops.find((s) => s.station_seq === fromSeq);
  const alight = train?.stops.find((s) => s.station_seq === toSeq);
  if (!train || !from || !to || !board?.depart_time || !(alight?.arrive_time ?? alight?.depart_time)) {
    return { ok: false, status: 400, error: 'この列車は指定の乗車駅・降車駅に停まりません' };
  }
  const forward = train.direction === 'down' ? fromSeq < toSeq : fromSeq > toSeq;
  if (!forward) return { ok: false, status: 400, error: '乗車駅と降車駅が列車の進行方向と逆です' };

  const timetable = await ensureBoard(
    tripId, BOARD_KIND[line.kind], line.name, from.name, to.name,
    `新幹線・特急の時刻表ライブラリから写した便${line.source_url ? ` (出典: ${line.source_url})` : ''}`,
  );
  const arrive = alight?.arrive_time ?? alight?.depart_time ?? null;
  const [dup] = (await sql`
    SELECT * FROM timetable_departures
    WHERE timetable_id=${timetable.id} AND depart_time=${board.depart_time} AND train_name=${train.train_name}
    LIMIT 1`) as TimetableDeparture[];
  if (dup) return { ok: true, timetable, departure: dup };

  const [cnt] = (await sql`SELECT COUNT(*) AS n FROM timetable_departures WHERE timetable_id=${timetable.id}`) as { n: number }[];
  const id = newId();
  await sql`INSERT INTO timetable_departures
    (id, timetable_id, depart_time, arrive_time, train_name, platform, fare_text, note, order_index)
    VALUES (${id}, ${timetable.id}, ${board.depart_time}, ${arrive}, ${train.train_name}, ${null}, ${null},
            ${`時刻表ライブラリ: ${line.name}${line.valid_from ? ` (${line.valid_from} 改正)` : ''}`}, ${cnt?.n ?? 0})`;
  const [departure] = (await sql`SELECT * FROM timetable_departures WHERE id=${id}`) as TimetableDeparture[];
  if (!departure) throw new Error('departure insert failed');
  return { ok: true, timetable, departure };
}
