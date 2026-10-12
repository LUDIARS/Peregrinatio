import { describe, expect, it } from 'vitest';
import { parseTimeCell, splitStationRole } from './time-cell.js';
import { parseTimetableTable } from './table-parse.js';
import { buildPasteImport, mergeStationOrder } from './paste-import.js';
import { validateImportPayload } from './import-validate.js';

describe('parseTimeCell', () => {
  it('時刻の書き方の揺れを HH:MM に寄せる', () => {
    expect(parseTimeCell('6:20')).toEqual({ kind: 'time', arrive: null, depart: '06:20' });
    expect(parseTimeCell('06:20')).toEqual({ kind: 'time', arrive: null, depart: '06:20' });
    expect(parseTimeCell('620')).toEqual({ kind: 'time', arrive: null, depart: '06:20' });
    expect(parseTimeCell('６：２０')).toEqual({ kind: 'time', arrive: null, depart: '06:20' });
  });

  it('通過記号と非経由を区別する', () => {
    for (const mark of ['↓', 'レ', '||', '｜', '通過']) expect(parseTimeCell(mark).kind).toBe('pass');
    for (const mark of ['', '―', '…', '=']) expect(parseTimeCell(mark).kind).toBe('none');
  });

  it('着発併記を読む', () => {
    expect(parseTimeCell('着6:20 発6:22')).toEqual({ kind: 'time', arrive: '06:20', depart: '06:22' });
    expect(parseTimeCell('6:20着 6:22発')).toEqual({ kind: 'time', arrive: '06:20', depart: '06:22' });
    expect(parseTimeCell('着9:05')).toEqual({ kind: 'time', arrive: '09:05', depart: null });
  });

  it('読めないセルは invalid として返す (黙って時刻にしない)', () => {
    expect(parseTimeCell('6時')).toEqual({ kind: 'invalid', raw: '6時' });
    expect(parseTimeCell('31:00').kind).toBe('invalid');
  });

  it('駅名列の着/発表記を外す', () => {
    expect(splitStationRole('大宮 着')).toEqual({ name: '大宮', role: 'arrive' });
    expect(splitStationRole('大宮(発)')).toEqual({ name: '大宮', role: 'depart' });
    expect(splitStationRole('宇都宮')).toEqual({ name: '宇都宮', role: null });
  });
});

describe('parseTimetableTable', () => {
  it('TSV の縦駅・横列車を読み、通過駅は停車にしない', () => {
    const tsv = [
      '駅名\tなすの401号\tやまびこ51号',
      '東京\t6:20\t6:40',
      '大宮\t6:46\tレ',
      '那須塩原\t7:29\t7:35',
    ].join('\n');
    const t = parseTimetableTable(tsv);
    expect(t.stations).toEqual(['東京', '大宮', '那須塩原']);
    expect(t.trains).toHaveLength(2);
    expect(t.trains[0]?.stops).toEqual([
      { station_seq: 0, arrive_time: null, depart_time: '06:20' },
      { station_seq: 1, arrive_time: null, depart_time: '06:46' },
      { station_seq: 2, arrive_time: '07:29', depart_time: null },
    ]);
    expect(t.trains[1]?.stops.map((s) => s.station_seq)).toEqual([0, 2]);
  });

  it('CSV でも読め、着行・発行を 1 駅にまとめる', () => {
    const csv = [
      ',ひたち1号',
      '上野,7:00',
      '水戸 着,8:10',
      '水戸 発,8:12',
      'いわき,9:15',
    ].join('\n');
    const t = parseTimetableTable(csv);
    expect(t.stations).toEqual(['上野', '水戸', 'いわき']);
    expect(t.trains[0]?.stops[1]).toEqual({ station_seq: 1, arrive_time: '08:10', depart_time: '08:12' });
  });

  it('日付をまたぐ時刻は 24:xx に直す', () => {
    const t = parseTimetableTable('駅\t最終\nA\t23:50\nB\t0:20');
    expect(t.trains[0]?.stops[1]).toEqual({ station_seq: 1, arrive_time: '24:20', depart_time: null });
  });

  it('読めないセルと停車 2 駅未満の列車は warnings に出す', () => {
    const t = parseTimetableTable('駅\tX\tY\nA\t6時\t7:00\nB\t\t7:30');
    expect(t.trains.map((x) => x.train_name)).toEqual(['Y']);
    expect(t.warnings.some((w) => w.includes('6時'))).toBe(true);
    expect(t.warnings.some((w) => w.includes('X は停車駅が 2 つ未満'))).toBe(true);
  });
});

describe('buildPasteImport', () => {
  const line = { name: '東北新幹線', kind: 'shinkansen' as const, operator: null, source_url: null, valid_from: null, notes: null };

  it('上り表を下り順の駅に並べ替えて 1 路線にまとめる', () => {
    const draft = buildPasteImport(line, [
      { direction: 'down', text: '駅\t下1\n東京\t6:00\n那須塩原\t7:10' },
      { direction: 'up', text: '駅\t上1\n那須塩原\t8:00\n宇都宮\t8:15\n東京\t9:10' },
    ]);
    expect(draft.stations.map((s) => s.name)).toEqual(['東京', '宇都宮', '那須塩原']);
    const up = draft.trains.find((t) => t.direction === 'up');
    expect(up?.stops.map((s) => s.station_seq)).toEqual([2, 1, 0]);
    const v = validateImportPayload(draft);
    expect(v.ok).toBe(true);
  });

  it('駅順のマージは既知の駅の直後に差し込む', () => {
    expect(mergeStationOrder(['A', 'C'], ['A', 'B', 'C'])).toEqual(['A', 'B', 'C']);
    expect(mergeStationOrder(['A', 'C'], ['X', 'A'])).toEqual(['X', 'A', 'C']);
  });
});

describe('validateImportPayload', () => {
  const base = {
    line: { name: '特急ひたち', kind: 'limited_express' },
    stations: [{ name: '上野' }, { name: '水戸' }, { name: 'いわき' }],
  };

  it('時刻が戻る列車・方向と駅順が合わない列車を落として warnings に出す', () => {
    const v = validateImportPayload({
      ...base,
      trains: [
        { train_name: 'ok', direction: 'down', stops: [{ station_seq: 0, depart_time: '07:00' }, { station_seq: 2, arrive_time: '09:00' }] },
        { train_name: 'back', direction: 'down', stops: [{ station_seq: 0, depart_time: '07:00' }, { station_seq: 1, arrive_time: '06:00' }] },
        { train_name: 'wrongdir', direction: 'up', stops: [{ station_seq: 0, depart_time: '07:00' }, { station_seq: 1, arrive_time: '08:00' }] },
        { train_name: 'ghost', direction: 'down', stops: [{ station_seq: 0, depart_time: '07:00' }, { station_seq: 9, arrive_time: '08:00' }] },
      ],
    });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.payload.trains.map((t) => t.train_name)).toEqual(['ok']);
    expect(v.payload.warnings).toHaveLength(3);
  });

  it('路線名・種別・駅が壊れていれば全体を拒否する', () => {
    expect(validateImportPayload({ ...base, line: { kind: 'shinkansen' }, trains: [] }).ok).toBe(false);
    expect(validateImportPayload({ ...base, line: { name: 'x', kind: 'bus' }, trains: [] }).ok).toBe(false);
    expect(validateImportPayload({ ...base, stations: [{ name: 'A' }, { name: 'A' }], trains: [] }).ok).toBe(false);
  });

  it('保存できる列車が 1 本も無ければ拒否する', () => {
    const v = validateImportPayload({ ...base, trains: [] });
    expect(v.ok).toBe(false);
  });
});
