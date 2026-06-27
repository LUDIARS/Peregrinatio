// 「場所の情報を追加する」共通処理。受け取ったものが URL か画像かで分岐する。
//   URL  → クロール→LLM 要約 (取り込みキューに積んで順次処理)。
//   画像 → アップロード+連結まで即時、解析は取り込みキューに積んで順次処理。
// 対象 place が無ければ新規作成する (新規はドラフト = 成立するまで場所リストに出ない)。
// 重い解析/クロールはサーバの worker がキューから 1 件ずつ処理する。AddInfo ページから利用。

import { api } from '../api.js';

export const isUrl = (s: string): boolean => /^https?:\/\/\S+$/i.test(s.trim());

export const hostOf = (u: string): string => {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
};

/** FileList / DataTransferItemList から画像 File だけを取り出す (貼り付け対応)。 */
export function collectImageFiles(list: FileList | DataTransferItemList | null): File[] {
  if (!list) return [];
  const out: File[] = [];
  for (const item of Array.from(list as ArrayLike<unknown>)) {
    if (item instanceof File) { if (item.type.startsWith('image/')) out.push(item); continue; }
    const di = item as DataTransferItem;
    if (di.kind === 'file' && di.type.startsWith('image/')) {
      const f = di.getAsFile();
      if (f) {
        const name = f.name && f.name !== 'image.png' ? f.name : `paste-${Date.now()}.png`;
        out.push(new File([f], name, { type: f.type }));
      }
    }
  }
  return out;
}

/** 情報付与の対象 place を決める (targetId 未指定なら新規作成)。 */
async function ensureTarget(
  tripId: string, targetId: string | null, fallbackName: string,
): Promise<{ id: string; created: boolean }> {
  if (targetId) return { id: targetId, created: false };
  const p = await api.addPlaceToTrip(tripId, { name: fallbackName });
  return { id: p.id, created: true };
}

/** URL のクロール→要約を取り込みキューに積む。作成/対象の place id を返す。 */
export async function enrichFromUrl(
  tripId: string, targetId: string | null, url: string,
): Promise<{ id: string; created: boolean }> {
  const t = await ensureTarget(tripId, targetId, hostOf(url));
  await api.createJob(tripId, { place_id: t.id, kind: 'crawl', source_url: url, is_new_place: t.created });
  return t;
}

/** 画像をアップロード+連結し、解析を取り込みキューに積む。作成/対象の place id を返す。 */
export async function enrichFromImages(
  tripId: string, targetId: string | null, files: File[],
): Promise<{ id: string; created: boolean }> {
  const t = await ensureTarget(tripId, targetId, '画像から取り込み中…');
  await api.uploadImages(t.id, files);
  await api.composeImages(t.id, 'rtl');
  await api.createJob(tripId, { place_id: t.id, kind: 'image', is_new_place: t.created });
  return t;
}
