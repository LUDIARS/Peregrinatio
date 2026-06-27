// その日の経路ウェイポイント列を組み立てる純関数 (IO なし・テスト対象)。
// 旅の出発地点 (自宅/集合地点) を、初日の先頭 (往路) と最終日の末尾 (復路) に注入する。

/** 経路の 1 地点。place なら place_id、出発/帰着地点 (origin) なら place_id=null + label。 */
export interface RouteWaypoint {
  place_id: string | null;
  label: string | null;
  lat: number;
  lng: number;
}

/** 旅の出発地点 (自宅/集合地点) のノード。 */
export interface OriginNode {
  label: string;
  lat: number;
  lng: number;
}

/**
 * placeNodes (その日の座標付き place を順に) に、必要なら出発地点を往路/復路として足す。
 * - origin があり isFirstDay なら先頭に往路の出発地点を、isLastDay なら末尾に復路の帰着地点を足す。
 * - place が 0 件なら行き先が無いので出発地点だけの区間は作らない (空配列)。
 * - 単日の旅 (isFirstDay && isLastDay) は origin → place… → origin の往復になる。
 */
export function buildRouteWaypoints(
  placeNodes: ReadonlyArray<{ place_id: string; lat: number; lng: number }>,
  origin: OriginNode | null,
  opts: { isFirstDay: boolean; isLastDay: boolean },
): RouteWaypoint[] {
  const out: RouteWaypoint[] = placeNodes.map((p) => ({ place_id: p.place_id, label: null, lat: p.lat, lng: p.lng }));
  if (out.length === 0) return out; // 行き先が無ければ出発地点だけの区間は作らない
  if (origin && opts.isFirstDay) {
    out.unshift({ place_id: null, label: origin.label, lat: origin.lat, lng: origin.lng });
  }
  if (origin && opts.isLastDay) {
    out.push({ place_id: null, label: origin.label, lat: origin.lat, lng: origin.lng });
  }
  return out;
}
