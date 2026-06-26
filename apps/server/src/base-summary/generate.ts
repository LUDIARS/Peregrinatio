// 拠点 (旅の base place) 周辺サマリーの生成。
//   base place が属する旅を 1 つ特定し、その旅に紐づく場所一覧・各 summary・
//   place_links を材料に @peregrinatio/llm complete でエリア要約を作り、
//   base place.summary に書き戻す。
// queue.ts (バックグラウンド走査) と routes/base-summary.ts (手動トリガ) の両方から呼ぶ。

import { complete } from '@peregrinatio/llm';
import { sql } from '../db/index.js';
import { nowIso } from '../lib/ids.js';
import { config } from '../config.js';
import type { Place, PlaceLink, TripPlace } from '../types.js';

/** 周辺場所がこの件数未満 (base 自身を除く) なら材料不足として要約しない。 */
const MIN_NEIGHBORS = 2;

export interface GenerateBaseSummaryResult {
  ok: boolean;
  summary?: string;
}

/**
 * 拠点 base place の周辺エリア要約を生成して place.summary に保存する。
 * - base が属する旅 (trip_places.is_base=1) を 1 つ特定し、その旅の場所一覧を集める。
 * - 周辺の名前/カテゴリ/住所/summary/リンクを材料に日本語 300〜500 字で要約。
 * - 材料不足・LLM 失敗時は {ok:false} を返す (例外は呼び出し側に委ねず握って false)。
 */
export async function generateBaseSummary(basePlaceId: string): Promise<GenerateBaseSummaryResult> {
  const [base] = (await sql`SELECT * FROM places WHERE id=${basePlaceId}`) as Place[];
  if (!base) return { ok: false };

  // この場所が拠点になっている旅を 1 つ特定 (複数あれば最新追加を採用)。
  const [membership] = (await sql`
    SELECT trip_id FROM trip_places
    WHERE place_id=${basePlaceId} AND is_base=1
    ORDER BY added_at DESC LIMIT 1`) as { trip_id: string }[];
  if (!membership) return { ok: false };
  const tripId = membership.trip_id;

  // 旅に紐づく場所一覧 (base 自身も含む)。
  const tripPlaces = (await sql`
    SELECT p.*, tp.is_base FROM places p
    JOIN trip_places tp ON tp.place_id = p.id
    WHERE tp.trip_id = ${tripId}
    ORDER BY tp.added_at`) as TripPlace[];

  const neighbors = tripPlaces.filter((p) => p.id !== basePlaceId);
  if (neighbors.length < MIN_NEIGHBORS) return { ok: false };

  // 各場所のリンク (タイトル/URL) を引く。
  const linksByPlace = new Map<string, PlaceLink[]>();
  for (const p of tripPlaces) {
    const links = (await sql`SELECT * FROM place_links WHERE place_id=${p.id} ORDER BY created_at`) as PlaceLink[];
    if (links.length > 0) linksByPlace.set(p.id, links);
  }

  const material = buildMaterial(base, neighbors, linksByPlace);

  const system = [
    'あなたは旅程アシスタントです。与えられた「拠点 (宿泊地/起点)」とその周辺に集めた場所情報をもとに、',
    'この拠点周辺がどんなエリアで、滞在中に何ができるかを日本語で要約してください。',
    '制約: 300〜500 字。誇張や創作はせず、与えられた材料に書かれた事実だけを使う。',
    '材料に無い固有名詞・営業情報・距離は書かない。地名やカテゴリの傾向から「どんなエリアか」を述べてよい。',
    '出力は本文のみ (見出し/箇条書き/前置き不要)。',
  ].join('\n');

  let raw: string;
  try {
    raw = await complete({ system, user: material, model: config.llm.summaryModel });
  } catch (err) {
    console.error(`[base-summary] LLM 生成に失敗 (place=${basePlaceId}):`, err);
    return { ok: false };
  }

  const summary = raw.trim();
  if (!summary) return { ok: false };

  const now = nowIso();
  await sql`UPDATE places SET summary=${summary}, updated_at=${now} WHERE id=${basePlaceId}`;
  return { ok: true, summary };
}

/** LLM へ渡す材料テキストを組み立てる。 */
function buildMaterial(
  base: Place,
  neighbors: TripPlace[],
  linksByPlace: Map<string, PlaceLink[]>,
): string {
  const lines: string[] = [];
  lines.push('# 拠点');
  lines.push(formatPlace(base, linksByPlace.get(base.id)));
  lines.push('');
  lines.push(`# 周辺に集めた場所 (${neighbors.length} 件)`);
  for (const p of neighbors) {
    lines.push(formatPlace(p, linksByPlace.get(p.id)));
  }
  return lines.join('\n');
}

/** 1 場所分を材料行に整形する。 */
function formatPlace(p: Place, links: PlaceLink[] | undefined): string {
  const parts: string[] = [`- ${p.name}`];
  if (p.category) parts.push(`  カテゴリ: ${p.category}`);
  if (p.address) parts.push(`  住所: ${p.address}`);
  if (p.summary && p.summary.trim()) parts.push(`  概要: ${p.summary.trim()}`);
  if (links && links.length > 0) {
    const linkText = links
      .map((l) => `${(l.title ?? '').trim() || l.url} (${l.url})`)
      .join(' / ');
    parts.push(`  リンク: ${linkText}`);
  }
  return parts.join('\n');
}
