// 貼り付けられた時刻表 (縦に駅、横に列車) を読む純関数。
//   1 行目        = 列車名 (先頭セルは見出し。空でも「駅名」でもよい)
//   2 行目以降    = 駅名, 時刻, 時刻, ...
// 区切りはタブ (表計算ソフト・PDF からのコピー) を優先し、無ければカンマ (CSV)。
// 同じ駅が「着」行・「発」行の 2 行に分かれている書き方は 1 駅にまとめる。
// ここでは表の並び (= 入力の進行方向) のまま返す。下り順への並べ替えは呼び側が行う。
// @implements SPEC-EXPRESS-IMPORT

import { parseCsvRows } from '../lib/csv.js';
import { clockToMinutes, minutesToClock, parseTimeCell, splitStationRole } from './time-cell.js';
import type { ExpressStopTime } from './types.js';

export interface ParsedTableTrain {
  train_name: string;
  /** 表の駅順 (0 始まり) で引ける停車時刻。station_seq は表の並びの添字。 */
  stops: ExpressStopTime[];
}

export interface ParsedTable {
  /** 表に出てきた順の駅名。 */
  stations: string[];
  trains: ParsedTableTrain[];
  warnings: string[];
}

/** 表を行×セルに分ける。タブが 1 つでもあれば TSV として扱う。 */
export function splitTableRows(text: string): string[][] {
  const normalized = text.replace(/\r\n?/g, '\n');
  const rows = normalized.includes('\t')
    ? normalized.split('\n').map((line) => line.split('\t'))
    : parseCsvRows(normalized);
  return rows.filter((cells) => cells.some((c) => c.trim() !== ''));
}

interface StationRow {
  name: string;
  /** その駅に属する元の行 (着行・発行・役割なし行)。 */
  parts: Array<{ role: 'arrive' | 'depart' | null; cells: string[] }>;
}

/** 連続する同名駅 (着行 + 発行) を 1 駅にまとめる。 */
function groupStationRows(rows: string[][]): StationRow[] {
  const out: StationRow[] = [];
  for (const cells of rows) {
    const { name, role } = splitStationRole(cells[0] ?? '');
    if (!name) continue;
    const prev = out[out.length - 1];
    const prevRoles = prev?.parts.map((p) => p.role) ?? [];
    // 同じ駅名が続き、役割が重ならないときだけ同じ駅とみなす (環状運転で同名駅が離れて出るのは別駅)。
    if (prev && prev.name === name && role !== null && !prevRoles.includes(role) && !prevRoles.includes(null)) {
      prev.parts.push({ role, cells: cells.slice(1) });
      continue;
    }
    out.push({ name, parts: [{ role, cells: cells.slice(1) }] });
  }
  return out;
}

/** 1 列車ぶんの停車時刻を組み、日付またぎを 24:xx に直す。 */
function finalizeStops(stops: ExpressStopTime[]): ExpressStopTime[] {
  let prev: number | null = null;
  let offset = 0;
  const roll = (value: string | null): string | null => {
    const minutes = clockToMinutes(value);
    if (minutes == null) return value;
    let v = minutes + offset;
    // 前の時刻より 12 時間以上戻ったら日付をまたいだとみなす (23:50 → 0:10)。
    if (prev != null && v < prev - 12 * 60) {
      offset += 24 * 60;
      v += 24 * 60;
    }
    prev = v;
    return minutesToClock(v);
  };
  const rolled = stops.map((s) => {
    const arrive = roll(s.arrive_time);
    const depart = roll(s.depart_time);
    return { ...s, arrive_time: arrive, depart_time: depart };
  });
  // 始発駅に着時刻は要らない。終着駅は単独の時刻を着時刻として扱う。
  const last = rolled[rolled.length - 1];
  if (last && last.arrive_time == null && last.depart_time != null && rolled.length > 1) {
    last.arrive_time = last.depart_time;
    last.depart_time = null;
  }
  return rolled;
}

export function parseTimetableTable(text: string): ParsedTable {
  const warnings: string[] = [];
  const rows = splitTableRows(text);
  if (rows.length < 2) {
    return { stations: [], trains: [], warnings: ['表が読めません。1 行目に列車名、2 行目以降に「駅名, 時刻…」を並べてください。'] };
  }

  const header = rows[0] ?? [];
  const trainNames = header.slice(1).map((n, i) => n.normalize('NFKC').trim() || `列車${i + 1}`);
  const stationRows = groupStationRows(rows.slice(1));
  const stations = stationRows.map((s) => s.name);

  const trains: ParsedTableTrain[] = [];
  trainNames.forEach((trainName, col) => {
    const stops: ExpressStopTime[] = [];
    stationRows.forEach((station, seq) => {
      let arrive: string | null = null;
      let depart: string | null = null;
      for (const part of station.parts) {
        const raw = part.cells[col] ?? '';
        const cell = parseTimeCell(raw);
        if (cell.kind === 'invalid') {
          warnings.push(`${trainName} の ${station.name} のセル「${raw.trim()}」を読めないため空欄として扱いました。`);
          continue;
        }
        if (cell.kind !== 'time') continue;
        if (part.role === 'arrive') arrive = cell.depart ?? cell.arrive;
        else if (part.role === 'depart') depart = cell.depart ?? cell.arrive;
        else {
          arrive = cell.arrive ?? arrive;
          depart = cell.depart ?? depart;
        }
      }
      if (arrive != null || depart != null) stops.push({ station_seq: seq, arrive_time: arrive, depart_time: depart });
    });
    if (stops.length < 2) {
      warnings.push(`${trainName} は停車駅が 2 つ未満のため外しました。`);
      return;
    }
    trains.push({ train_name: trainName, stops: finalizeStops(stops) });
  });

  return { stations, trains, warnings };
}
