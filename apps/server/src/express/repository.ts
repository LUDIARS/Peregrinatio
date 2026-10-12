// 時刻表ライブラリの DB 読み書き。SQL はここに閉じる (ルート・提案ロジックは型だけを扱う)。
// @implements SPEC-EXPRESS-LIBRARY

import { sql } from '../db/index.js';
import { newId, nowIso } from '../lib/ids.js';
import type {
  ExpressImportPayload,
  ExpressLine,
  ExpressLineDetail,
  ExpressLineSummary,
  ExpressStation,
  ExpressStopTime,
  ExpressTrain,
} from './types.js';

export async function listExpressLines(): Promise<ExpressLineSummary[]> {
  return (await sql`
    SELECT l.*,
      (SELECT COUNT(*) FROM express_stations s WHERE s.line_id = l.id) AS station_count,
      (SELECT COUNT(*) FROM express_trains t WHERE t.line_id = l.id) AS train_count
    FROM express_lines l
    ORDER BY l.name, l.imported_at`) as ExpressLineSummary[];
}

export async function getExpressLine(id: string): Promise<ExpressLine | null> {
  const [line] = (await sql`SELECT * FROM express_lines WHERE id=${id}`) as ExpressLine[];
  return line ?? null;
}

export async function listStations(lineId: string): Promise<ExpressStation[]> {
  return (await sql`
    SELECT line_id, seq, name, lat, lng FROM express_stations WHERE line_id=${lineId} ORDER BY seq`) as ExpressStation[];
}

/** 座標のある全路線の駅 (乗車駅・降車駅の探索、アクセス印の最寄り駅に使う)。 */
export async function listLocatedStations(): Promise<Array<ExpressStation & { line_name: string; lat: number; lng: number }>> {
  return (await sql`
    SELECT s.line_id, s.seq, s.name, s.lat, s.lng, l.name AS line_name
    FROM express_stations s JOIN express_lines l ON l.id = s.line_id
    WHERE s.lat IS NOT NULL AND s.lng IS NOT NULL`) as Array<ExpressStation & { line_name: string; lat: number; lng: number }>;
}

export async function listTrains(lineId: string): Promise<ExpressTrain[]> {
  const trains = (await sql`
    SELECT id, line_id, direction, train_name, service_note FROM express_trains
    WHERE line_id=${lineId}`) as Array<Omit<ExpressTrain, 'stops'>>;
  const stops = (await sql`
    SELECT st.train_id, st.station_seq, st.arrive_time, st.depart_time
    FROM express_stop_times st JOIN express_trains t ON t.id = st.train_id
    WHERE t.line_id=${lineId}`) as Array<ExpressStopTime & { train_id: string }>;
  const byTrain = new Map<string, ExpressStopTime[]>();
  for (const s of stops) {
    const list = byTrain.get(s.train_id) ?? [];
    list.push({ station_seq: s.station_seq, arrive_time: s.arrive_time, depart_time: s.depart_time });
    byTrain.set(s.train_id, list);
  }
  const out = trains.map((t) => {
    const list = byTrain.get(t.id) ?? [];
    list.sort((a, b) => (t.direction === 'down' ? a.station_seq - b.station_seq : b.station_seq - a.station_seq));
    return { ...t, stops: list };
  });
  // 始発駅の発時刻順に並べる (画面の表と提案の走査を安定させる)。
  const firstDepart = (t: ExpressTrain) => t.stops[0]?.depart_time ?? '99:99';
  out.sort((a, b) => a.direction.localeCompare(b.direction) || firstDepart(a).localeCompare(firstDepart(b)));
  return out;
}

export async function getExpressLineDetail(id: string): Promise<ExpressLineDetail | null> {
  const line = await getExpressLine(id);
  if (!line) return null;
  return { ...line, stations: await listStations(id), trains: await listTrains(id) };
}

/**
 * 取り込みを単一トランザクションで保存する。replaceLineId があればその路線を置き換える
 * (列車・駅は作り直す。旅の区間ボードへ写した便は旅側に残るので影響しない)。
 */
export async function saveExpressImport(payload: ExpressImportPayload, replaceLineId: string | null): Promise<string> {
  const lineId = replaceLineId ?? newId();
  const { line } = payload;
  await sql.begin(async (tx) => {
    if (replaceLineId) {
      await tx`DELETE FROM express_trains WHERE line_id=${lineId}`;
      await tx`DELETE FROM express_stations WHERE line_id=${lineId}`;
      await tx`UPDATE express_lines SET name=${line.name}, kind=${line.kind}, operator=${line.operator},
        source_url=${line.source_url}, valid_from=${line.valid_from}, notes=${line.notes}, imported_at=${nowIso()}
        WHERE id=${lineId}`;
    } else {
      await tx`INSERT INTO express_lines (id, name, kind, operator, source_url, valid_from, notes, imported_at)
        VALUES (${lineId}, ${line.name}, ${line.kind}, ${line.operator}, ${line.source_url}, ${line.valid_from},
                ${line.notes}, ${nowIso()})`;
    }
    for (const s of payload.stations) {
      await tx`INSERT INTO express_stations (line_id, seq, name, lat, lng)
        VALUES (${lineId}, ${s.seq}, ${s.name}, ${s.lat}, ${s.lng})`;
    }
    for (const t of payload.trains) {
      const trainId = newId();
      await tx`INSERT INTO express_trains (id, line_id, direction, train_name, service_note)
        VALUES (${trainId}, ${lineId}, ${t.direction}, ${t.train_name}, ${t.service_note})`;
      for (const s of t.stops) {
        await tx`INSERT INTO express_stop_times (train_id, station_seq, arrive_time, depart_time)
          VALUES (${trainId}, ${s.station_seq}, ${s.arrive_time}, ${s.depart_time})`;
      }
    }
  });
  return lineId;
}

export async function deleteExpressLine(id: string): Promise<void> {
  await sql`DELETE FROM express_lines WHERE id=${id}`;
}

/** 駅座標の手修正。null で座標を消す。 */
export async function updateStationCoords(lineId: string, seq: number, lat: number | null, lng: number | null): Promise<ExpressStation | null> {
  await sql`UPDATE express_stations SET lat=${lat}, lng=${lng} WHERE line_id=${lineId} AND seq=${seq}`;
  const [row] = (await sql`
    SELECT line_id, seq, name, lat, lng FROM express_stations WHERE line_id=${lineId} AND seq=${seq}`) as ExpressStation[];
  return row ?? null;
}
