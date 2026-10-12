// @implements SPEC-ACCESS-UI
import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import type { AccessMarks } from '../../types.js';

/**
 * 旅の場所ごとのアクセス印を読む。旅の詳細 (GET /api/trips/:id) とは別に取るのは、
 * 印の判定が Places を呼ぶことがあり、一覧の表示そのものを待たせないため。
 * placesKey (場所 ID の並び) が変わったら取り直す。失敗は error で返す (黙って「印なし」にしない)。
 */
export function useTripAccessMarks(tripId: string | undefined, placesKey: string): {
  marks: Record<string, AccessMarks>;
  error: string;
} {
  const [marks, setMarks] = useState<Record<string, AccessMarks>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;
    api.tripAccessMarks(tripId)
      .then((m) => { if (!cancelled) { setMarks(m); setError(''); } })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'アクセス印を読めませんでした'); });
    return () => { cancelled = true; };
  }, [tripId, placesKey]);
  return { marks, error };
}
