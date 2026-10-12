// 応答の行 (旅の場所 / 未保存の候補) を判定の入力 AccessCandidate に変える。
// @implements SPEC-ACCESS-ATTACH

import { facilityNamesOf } from './attach.js';
import type { AccessCandidate } from './types.js';

interface PlaceRow {
  id: string;
  lat: number | null;
  lng: number | null;
  summary: string | null;
  notes: string | null;
}

/** 旅の場所 (保存済み): 本文 (要約・メモ・設備) を持つのでシャトルも判定する。 */
export async function placeCandidateFactory(rows: readonly PlaceRow[]): Promise<(row: PlaceRow) => AccessCandidate | null> {
  const facilities = await facilityNamesOf(rows.map((r) => r.id));
  return (row) => (row.lat == null || row.lng == null ? null : {
    cache_key: row.id,
    lat: row.lat,
    lng: row.lng,
    texts: { place_id: row.id, summary: row.summary, notes: row.notes, facilities: facilities.get(row.id) ?? [] },
  });
}

/** 未保存の候補 (プランの new_places・検索結果): 本文が無いのでシャトルは判定しない。 */
export function unsavedCandidate(row: { place_id?: string; google_place_id?: string; lat: number | null; lng: number | null }): AccessCandidate | null {
  const key = row.google_place_id ?? row.place_id;
  if (!key || row.lat == null || row.lng == null) return null;
  return { cache_key: `google:${key}`, lat: row.lat, lng: row.lng, texts: null };
}
