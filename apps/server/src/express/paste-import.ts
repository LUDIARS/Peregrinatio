// 貼り付けた表 (方向ごとに 1 枚) から取り込みデータを組み立てる純関数。
// 上り表は駅が上り方向に並んでいるので、下り方向の seq に並べ替えてから下り表と駅順を合わせる。
// 組み立てた結果は validateImportPayload で検証してからプレビューに出す (ここでは整合を直さない)。
// @implements SPEC-EXPRESS-IMPORT

import { parseTimetableTable } from './table-parse.js';
import type { ExpressDirection, ExpressImportLine, ExpressImportTrain } from './types.js';

export interface PastedTable {
  direction: ExpressDirection;
  text: string;
}

export interface PasteImportDraft {
  line: ExpressImportLine;
  stations: Array<{ name: string; lat: null; lng: null }>;
  trains: ExpressImportTrain[];
  warnings: string[];
}

/**
 * 2 つの駅順 (どちらも下り方向) を 1 本にまとめる。
 * b にしか無い駅は、b 上で直前にある既知の駅の直後に差し込む (停車駅が表ごとに違っても並びを壊さない)。
 */
export function mergeStationOrder(a: readonly string[], b: readonly string[]): string[] {
  const merged = [...a];
  let anchor = -1;
  for (const name of b) {
    const at = merged.indexOf(name);
    if (at >= 0) { anchor = at; continue; }
    merged.splice(anchor + 1, 0, name);
    anchor += 1;
  }
  return merged;
}

export function buildPasteImport(line: ExpressImportLine, tables: readonly PastedTable[]): PasteImportDraft {
  const warnings: string[] = [];
  const parsed = tables.map((t) => {
    const table = parseTimetableTable(t.text);
    const label = t.direction === 'down' ? '下り' : '上り';
    warnings.push(...table.warnings.map((w) => `${label}: ${w}`));
    // 上り表は表の上から上り方向。下り順の駅名列に直す。
    const downOrder = t.direction === 'down' ? table.stations : [...table.stations].reverse();
    return { direction: t.direction, table, downOrder };
  });

  let stations: string[] = [];
  for (const p of parsed) stations = mergeStationOrder(stations, p.downOrder);
  const seqOf = new Map(stations.map((name, seq) => [name, seq] as const));

  const trains: ExpressImportTrain[] = [];
  for (const p of parsed) {
    for (const train of p.table.trains) {
      trains.push({
        direction: p.direction,
        train_name: train.train_name,
        service_note: 'daily',
        stops: train.stops.map((s) => ({
          ...s,
          station_seq: seqOf.get(p.table.stations[s.station_seq] ?? '') ?? -1,
        })),
      });
    }
  }

  return { line, stations: stations.map((name) => ({ name, lat: null, lng: null })), trains, warnings };
}
