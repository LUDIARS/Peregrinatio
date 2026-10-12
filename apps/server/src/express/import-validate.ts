// 取り込みデータ (貼り付けの解析結果 / LLM 抽出 / 保存リクエストの本文) を検証して正規化する純関数。
// 信用できない入力を「保存してよい形」にする唯一の入口。崩れた列車は黙って直さず落とし、理由を warnings に出す。
//   - 駅は下り方向の seq 順。名前の重複・空は不可。
//   - 列車の停車駅は進行方向 (down=seq 昇順 / up=seq 降順) に並び、時刻は単調に増える。
// @implements SPEC-EXPRESS-IMPORT

import { clockToMinutes, normalizeClock } from './time-cell.js';
import {
  EXPRESS_DIRECTIONS,
  EXPRESS_LINE_KINDS,
  type ExpressDirection,
  type ExpressImportPayload,
  type ExpressImportStation,
  type ExpressImportTrain,
  type ExpressLineKind,
  type ExpressStopTime,
} from './types.js';

const MAX_STATIONS = 200;
const MAX_TRAINS = 2_000;
const MAX_TEXT = 500;

export type ImportValidation =
  | { ok: true; payload: ExpressImportPayload }
  | { ok: false; error: string };

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.normalize('NFKC').trim();
  return t ? Array.from(t).slice(0, MAX_TEXT).join('') : null;
}

function coord(value: unknown, limit: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}

function dateText(value: unknown): string | null {
  const t = text(value);
  return t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

function clock(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return undefined;
  return normalizeClock(value.normalize('NFKC')) ?? undefined;
}

function parseStations(raw: unknown): { stations: ExpressImportStation[]; error: string | null } {
  if (!Array.isArray(raw) || raw.length < 2) return { stations: [], error: '駅が 2 つ以上必要です' };
  if (raw.length > MAX_STATIONS) return { stations: [], error: `駅は ${MAX_STATIONS} 件までです` };
  const stations: ExpressImportStation[] = [];
  const seen = new Set<string>();
  for (const [index, item] of raw.entries()) {
    const r = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    const name = text(r.name);
    if (!name) return { stations: [], error: `${index + 1} 番目の駅名が空です` };
    if (seen.has(name)) return { stations: [], error: `駅名「${name}」が重複しています` };
    seen.add(name);
    // seq は並び順で振り直す (入力の seq は信用しない。下り方向の並びが正本)。
    stations.push({ seq: index, name, lat: coord(r.lat, 90), lng: coord(r.lng, 180) });
  }
  return { stations, error: null };
}

/** 停車駅の並びと時刻の単調性を確かめる。崩れていれば理由を返す。 */
export function trainProblem(direction: ExpressDirection, stops: readonly ExpressStopTime[]): string | null {
  if (stops.length < 2) return '停車駅が 2 つ未満です';
  let prevSeq: number | null = null;
  let prevTime: number | null = null;
  for (const s of stops) {
    if (prevSeq != null) {
      const forward = direction === 'down' ? s.station_seq > prevSeq : s.station_seq < prevSeq;
      if (!forward) return '停車駅の順序が進行方向と合いません';
    }
    prevSeq = s.station_seq;
    for (const t of [s.arrive_time, s.depart_time]) {
      const minutes = clockToMinutes(t);
      if (minutes == null) continue;
      if (prevTime != null && minutes < prevTime) return `${t} で時刻が前の駅より戻っています`;
      prevTime = minutes;
    }
  }
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first?.depart_time) return '始発駅の発時刻がありません';
  if (!(last?.arrive_time ?? last?.depart_time)) return '終着駅の着時刻がありません';
  return null;
}

function parseTrain(
  raw: unknown,
  stationCount: number,
  index: number,
): { train: ExpressImportTrain | null; warning: string | null } {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const name = text(r.train_name) ?? `列車${index + 1}`;
  const direction = (EXPRESS_DIRECTIONS as readonly unknown[]).includes(r.direction)
    ? r.direction as ExpressDirection
    : null;
  if (!direction) return { train: null, warning: `${name}: 方向 (down/up) が無いため外しました。` };

  const stopsRaw = Array.isArray(r.stops) ? r.stops : [];
  const stops: ExpressStopTime[] = [];
  const seenSeq = new Set<number>();
  for (const s of stopsRaw) {
    const o = (typeof s === 'object' && s !== null ? s : {}) as Record<string, unknown>;
    const seq = o.station_seq;
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0 || seq >= stationCount || seenSeq.has(seq)) {
      return { train: null, warning: `${name}: 存在しない駅または重複した駅を含むため外しました。` };
    }
    const arrive = clock(o.arrive_time);
    const depart = clock(o.depart_time);
    if (arrive === undefined || depart === undefined) {
      return { train: null, warning: `${name}: 時刻の形式が読めないため外しました。` };
    }
    if (arrive == null && depart == null) continue;
    seenSeq.add(seq);
    stops.push({ station_seq: seq, arrive_time: arrive, depart_time: depart });
  }
  const problem = trainProblem(direction, stops);
  if (problem) return { train: null, warning: `${name}: ${problem}ため外しました。` };
  return {
    train: { direction, train_name: name, service_note: text(r.service_note) ?? 'daily', stops },
    warning: null,
  };
}

/** 本文を検証・正規化する。路線/駅が壊れていれば全体を拒否し、列車単位の崩れは落として warnings に積む。 */
export function validateImportPayload(raw: unknown): ImportValidation {
  const body = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const lineRaw = (typeof body.line === 'object' && body.line !== null ? body.line : {}) as Record<string, unknown>;
  const name = text(lineRaw.name);
  if (!name) return { ok: false, error: '路線名を入力してください' };
  const kind = (EXPRESS_LINE_KINDS as readonly unknown[]).includes(lineRaw.kind)
    ? lineRaw.kind as ExpressLineKind
    : null;
  if (!kind) return { ok: false, error: '種別は shinkansen / limited_express のどちらかです' };

  const { stations, error } = parseStations(body.stations);
  if (error) return { ok: false, error };

  const trainsRaw = Array.isArray(body.trains) ? body.trains : [];
  if (trainsRaw.length > MAX_TRAINS) return { ok: false, error: `列車は ${MAX_TRAINS} 本までです` };

  const warnings = Array.isArray(body.warnings)
    ? body.warnings.filter((w): w is string => typeof w === 'string').slice(0, 200)
    : [];
  const trains: ExpressImportTrain[] = [];
  trainsRaw.forEach((t, i) => {
    const parsed = parseTrain(t, stations.length, i);
    if (parsed.warning) warnings.push(parsed.warning);
    if (parsed.train) trains.push(parsed.train);
  });
  if (trains.length === 0) return { ok: false, error: '保存できる列車がありません (時刻と駅順を確認してください)' };

  return {
    ok: true,
    payload: {
      line: {
        name,
        kind,
        operator: text(lineRaw.operator),
        source_url: text(lineRaw.source_url),
        valid_from: dateText(lineRaw.valid_from),
        notes: text(lineRaw.notes),
      },
      stations,
      trains,
      warnings,
    },
  };
}
