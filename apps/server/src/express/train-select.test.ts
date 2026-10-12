import { describe, expect, it } from 'vitest';
import { isTimetableStale, serviceDayVerdict } from './service-day.js';
import { pickStations, type LocatedStation } from './station-pick.js';
import { selectInbound, selectOutbound, trainSegments } from './train-select.js';
import { clockToMinutes } from './time-cell.js';
import type { ExpressTrain } from './types.js';

function train(id: string, direction: 'down' | 'up', times: Array<[number, string]>, service_note = 'daily'): ExpressTrain {
  return {
    id, line_id: 'L', direction, train_name: id, service_note,
    stops: times.map(([seq, t], i) => ({
      station_seq: seq,
      arrive_time: i === times.length - 1 ? t : null,
      depart_time: i === times.length - 1 ? null : t,
    })),
  };
}

// 2026-10-17 は土曜、2026-10-19 は月曜。
const SAT = '2026-10-17';
const MON = '2026-10-19';

describe('serviceDayVerdict / isTimetableStale', () => {
  it('weekday / holiday を曜日で判定し、自由文は unknown', () => {
    expect(serviceDayVerdict('daily', SAT)).toBe('runs');
    expect(serviceDayVerdict('weekday', SAT)).toBe('not_running');
    expect(serviceDayVerdict('weekday', MON)).toBe('runs');
    expect(serviceDayVerdict('holiday', SAT)).toBe('runs');
    expect(serviceDayVerdict('holiday', MON)).toBe('not_running');
    expect(serviceDayVerdict('臨時', MON)).toBe('unknown');
  });

  it('valid_from から 1 年以上たった旅の日付だけ古いとみなす', () => {
    expect(isTimetableStale('2025-10-19', MON)).toBe(true);
    expect(isTimetableStale('2025-10-20', MON)).toBe(false);
    expect(isTimetableStale(null, MON)).toBe(false);
  });
});

describe('trainSegments', () => {
  const trains = [
    train('d1', 'down', [[0, '08:00'], [1, '08:30'], [2, '09:00']]),
    train('d2', 'down', [[0, '09:00'], [2, '10:00']]),
    train('w', 'down', [[0, '10:00'], [2, '11:00']], 'weekday'),
    train('u1', 'up', [[2, '12:00'], [0, '13:00']]),
  ];

  it('乗車駅と降車駅の両方に停まる同方向の列車だけを返す', () => {
    expect(trainSegments(trains, 0, 1, MON).map((s) => s.train.id)).toEqual(['d1']);
    expect(trainSegments(trains, 0, 2, MON).map((s) => s.train.id)).toEqual(['d1', 'd2', 'w']);
    expect(trainSegments(trains, 2, 0, MON).map((s) => s.train.id)).toEqual(['u1']);
  });

  it('運行日でない列車を外す', () => {
    expect(trainSegments(trains, 0, 2, SAT).map((s) => s.train.id)).toEqual(['d1', 'd2']);
  });
});

describe('selectOutbound', () => {
  const trains = ['06', '07', '08', '09', '10', '11', '12', '13', '14'].map((h) =>
    train(`t${h}`, 'down', [[0, `${h}:00`], [1, `${h}:50`]]));
  const segments = trainSegments(trains, 0, 1, MON);
  // 端末交通は 30 分。
  const terminal = async (arr: number) => ({ arrive_min: arr + 30, leg: 'taxi' });

  it('チェックインに間に合う便を遅い順に 3 本 + 最も早い便を返す', async () => {
    const picked = await selectOutbound(segments, clockToMinutes('15:00')!, terminal);
    expect(picked.map((p) => p.segment.train.id)).toEqual(['t13', 't12', 't11', 't06']);
  });

  it('端末交通を足すと間に合わない便は外す', async () => {
    const picked = await selectOutbound(segments, clockToMinutes('14:00')!, terminal);
    expect(picked[0]?.segment.train.id).toBe('t12');
  });

  it('端末交通が引けない便は候補にしない', async () => {
    const picked = await selectOutbound(segments, clockToMinutes('15:00')!, async () => null);
    expect(picked).toEqual([]);
  });
});

describe('selectInbound', () => {
  it('駅に着いた後に出る便を早い順に 3 本', () => {
    const trains = ['15', '16', '17', '18', '19'].map((h) => train(`u${h}`, 'up', [[1, `${h}:10`], [0, `${h}:59`]]));
    const segments = trainSegments(trains, 1, 0, MON);
    expect(selectInbound(segments, clockToMinutes('16:00')!).map((s) => s.train.id)).toEqual(['u16', 'u17', 'u18']);
  });
});

describe('pickStations', () => {
  const stations: LocatedStation[] = [
    { line_id: 'tohoku', line_name: '東北新幹線', seq: 0, name: '東京', lat: 35.6812, lng: 139.7671 },
    { line_id: 'tohoku', line_name: '東北新幹線', seq: 1, name: '那須塩原', lat: 36.9317, lng: 140.0209 },
    { line_id: 'tokaido', line_name: '東海道新幹線', seq: 0, name: '東京', lat: 35.6813, lng: 139.7672 },
    { line_id: 'tokaido', line_name: '東海道新幹線', seq: 1, name: '静岡', lat: 34.9719, lng: 138.3889 },
  ];
  const home = { lat: 35.69, lng: 139.70 };
  const nasu = { lat: 37.05, lng: 140.0 };

  it('同じ乗車駅が複数路線にあるときは拠点側が近い路線を採る', () => {
    const r = pickStations(stations, home, nasu);
    expect(r.ok && r.pick.line_id).toBe('tohoku');
    expect(r.ok && r.pick.alight.name).toBe('那須塩原');
    expect(r.ok && r.pick.outbound_direction).toBe('down');
  });

  it('出発地点から 50km を超える駅しか無ければ候補外', () => {
    const r = pickStations(stations, { lat: 34.0, lng: 135.0 }, nasu);
    expect(r.ok).toBe(false);
  });

  it('駅が 1 つも無ければ理由を返す', () => {
    expect(pickStations([], home, nasu).ok).toBe(false);
  });
});
