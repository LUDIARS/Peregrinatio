// 施設サマリーのクロール→LLM が返したシャトルバスの有無を保存する。
// 以後のアクセス印はキーワード検索よりこちらを優先する (judgeShuttleBus)。
// @implements SPEC-ACCESS-SHUTTLE

import type { PlaceInfo } from '@peregrinatio/crawl';
import { writeAccessCache } from './cache.js';
import type { ShuttleExtraction } from './shuttle.js';

/** LLM が有無を判断しなかった (shuttle_bus が無い) ときは何も書かない — 以前の判断を消さない。 */
export async function saveShuttleExtraction(placeId: string, info: PlaceInfo, sourceUrl: string | null): Promise<void> {
  if (!info.shuttle_bus) return;
  const value: ShuttleExtraction = {
    available: info.shuttle_bus.available,
    evidence: info.shuttle_bus.evidence || null,
    source_url: sourceUrl,
  };
  await writeAccessCache(placeId, 'shuttle_llm', value);
}
