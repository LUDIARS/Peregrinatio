// プランの主軸 (その日の目当てになる場所) を選ぶ。
//
// 日割りを「拠点から近い順」で組むと、目当てのない移動が並ぶ。
// 先に主軸を決めて、そこへの経路を逆算するほうが旅として筋が通る。
//
// 主軸の優先順位:
//   0. must 指定 (必ず行くと決めた場所) — 他のどの理由より先に置く
//   1. ユーザが「気になる」を付けた場所 (明示的な意思)
//   2. 半日仕事になる種別 (テーマパーク・美術館・自然) — 1 日の骨になる
//   3. 調べた形跡がある場所 (要約・画像を取得済み)
// 足りなければ Places で拠点周辺の著名スポットを補って提案する。

import { searchPlaces, type PlaceSearchResult } from '@peregrinatio/places';
import { baseVisitMinutes } from './plan-visit.js';
import type { TripPlace } from '../types.js';

/** 主軸として扱う滞在時間の下限 (分)。これ未満は「ついでに寄る場所」。 */
export const ANCHOR_MIN_VISIT_MINUTES = 90;

/** 沿線で新しく探すときの検索語。拠点周辺の「目当てになる」ものに寄せる。 */
export const ANCHOR_SEARCH_QUERIES = ['名所', '観光スポット', '美術館 博物館', '自然 景勝地'];

/** 1 回の補充で採る最大件数。 */
const MAX_SUPPLEMENT = 12;

export interface AnchorScore {
  place: TripPlace;
  score: number;
  /** なぜ主軸なのか (UI とログの説明用)。 */
  reason: string;
}

/**
 * must 指定に与える下駄。他のどの加点よりも大きくして、必ず先頭へ来るようにする
 * (spec: must_place_ids はペースの件数上限より先に評価する)。
 */
const MUST_SCORE = 1_000;

/** 主軸らしさのスコア。大きいほど先に日程へ置く。 */
export function anchorScore(place: TripPlace, mustIds?: ReadonlySet<string>): AnchorScore {
  let score = 0;
  const reasons: string[] = [];

  if (mustIds?.has(place.id)) {
    score += MUST_SCORE;
    reasons.push('必ず行くと指定した場所');
  }
  if (place.status === 'interested') {
    score += 100;
    reasons.push('「気になる」を付けた場所');
  }
  const visit = baseVisitMinutes(place);
  if (visit >= ANCHOR_MIN_VISIT_MINUTES) {
    score += Math.min(60, visit / 4);
    reasons.push(`滞在が ${visit} 分見込みで 1 日の軸になる`);
  }
  if (place.summary) {
    score += 10;
    reasons.push('調べて要約済み');
  }
  if (place.image_url) score += 5;
  if (place.status === 'visited') {
    score -= 50;
    reasons.push('訪問済み');
  }

  return { place, score, reason: reasons.join(' / ') || '通常の候補' };
}

/** 主軸候補をスコア順に並べる。must 指定は他の加点より先に来る。 */
export function rankAnchors(places: readonly TripPlace[], mustIds?: ReadonlySet<string>): AnchorScore[] {
  return places.map((p) => anchorScore(p, mustIds)).sort((a, b) => b.score - a.score);
}

/** 旅にまだ無い、提案だけの場所。採用時は予定のメモ行になり、別途「旅に追加」できる。 */
export interface NewPlaceCandidate {
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  google_place_id: string;
  category: string | null;
  /** どの検索語で見つけたか。 */
  found_by: string;
}

function toCandidate(result: PlaceSearchResult, foundBy: string): NewPlaceCandidate | null {
  if (result.lat == null || result.lng == null || !result.name) return null;
  return {
    name: result.name,
    address: result.address ?? null,
    lat: result.lat,
    lng: result.lng,
    google_place_id: result.place_id,
    category: result.category ?? null,
    found_by: foundBy,
  };
}

/**
 * 拠点周辺の著名スポットを探して主軸候補を補う。
 * 既に旅にある場所と同名のものは返さない (重複提案を避ける)。
 * API キーが無ければ何も返さない (呼び側が warning にする)。
 */
export async function supplementAnchors(
  base: { lat: number; lng: number },
  radiusM: number,
  apiKey: string,
  existingNames: ReadonlySet<string>,
): Promise<NewPlaceCandidate[]> {
  if (!apiKey) return [];
  const found: NewPlaceCandidate[] = [];
  const seen = new Set<string>(existingNames);

  for (const q of ANCHOR_SEARCH_QUERIES) {
    let results: PlaceSearchResult[];
    try {
      results = await searchPlaces({ q, lat: base.lat, lng: base.lng, radius: radiusM }, apiKey);
    } catch {
      continue; // 1 カテゴリの失敗で補充全体を止めない。
    }
    for (const r of results) {
      if (!r.name || seen.has(r.name)) continue;
      const candidate = toCandidate(r, q);
      if (!candidate) continue;
      seen.add(r.name);
      found.push(candidate);
      if (found.length >= MAX_SUPPLEMENT) return found;
    }
  }
  return found;
}
