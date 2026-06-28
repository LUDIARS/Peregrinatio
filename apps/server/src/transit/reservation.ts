// 新幹線/飛行機の予約サジェスト。
// 旅の出発地点と目的地 (座標) から、最寄りの新幹線駅・空港を幾何的に特定し、
// 対応する JR 予約サイト / フライト検索のリンクを提示する。
// 予約サイト URL の正確性を重視し、LLM 推定ではなく決定的な静的データで判定する。
// データは主要コリドー/空港に限定 (網羅ではない)。座標は代表値。

export interface LatLng { lat: number; lng: number }

export interface ReservationSuggestion {
  mode: 'shinkansen' | 'flight';
  title: string;       // 路線/便種の表示名 (例「東海道・山陽新幹線」)
  operator: string;    // 運営 (例「JR東海 / JR西日本」)
  from: string;        // 出発駅/空港の表示名
  to: string;          // 到着駅/空港の表示名
  url: string;         // 予約/検索サイト
  note?: string;       // 補足 (乗換あり等)
  distance_km: number; // 出発地点→目的地の直線距離 (目安)
}

interface Station { name: string; lat: number; lng: number }
interface Corridor {
  id: string;
  name: string;
  operator: string;
  reservationName: string;
  reservationUrl: string;
  stations: Station[];
}
interface Airport { code: string; name: string; lat: number; lng: number }

// ── 新幹線コリドー (直通運転の実態に合わせた実用上の「1 路線」単位) ──────────────
const CORRIDORS: Corridor[] = [
  {
    id: 'tokaido-sanyo', name: '東海道・山陽新幹線', operator: 'JR東海 / JR西日本',
    reservationName: 'スマートEX', reservationUrl: 'https://smart-ex.jp/',
    stations: [
      { name: '東京', lat: 35.681, lng: 139.767 }, { name: '品川', lat: 35.628, lng: 139.738 },
      { name: '新横浜', lat: 35.507, lng: 139.617 }, { name: '名古屋', lat: 35.170, lng: 136.882 },
      { name: '京都', lat: 34.985, lng: 135.758 }, { name: '新大阪', lat: 34.733, lng: 135.500 },
      { name: '新神戸', lat: 34.679, lng: 135.197 }, { name: '岡山', lat: 34.666, lng: 133.918 },
      { name: '広島', lat: 34.398, lng: 132.475 }, { name: '博多', lat: 33.590, lng: 130.421 },
    ],
  },
  {
    id: 'tohoku-hokkaido', name: '東北・北海道新幹線', operator: 'JR東日本 / JR北海道',
    reservationName: 'えきねっと', reservationUrl: 'https://www.eki-net.com/',
    stations: [
      { name: '東京', lat: 35.681, lng: 139.767 }, { name: '上野', lat: 35.714, lng: 139.777 },
      { name: '大宮', lat: 35.906, lng: 139.624 }, { name: '仙台', lat: 38.260, lng: 140.882 },
      { name: '盛岡', lat: 39.701, lng: 141.136 }, { name: '新青森', lat: 40.827, lng: 140.694 },
      { name: '新函館北斗', lat: 41.905, lng: 140.646 },
    ],
  },
  {
    id: 'joetsu', name: '上越新幹線', operator: 'JR東日本',
    reservationName: 'えきねっと', reservationUrl: 'https://www.eki-net.com/',
    stations: [
      { name: '東京', lat: 35.681, lng: 139.767 }, { name: '大宮', lat: 35.906, lng: 139.624 },
      { name: '高崎', lat: 36.323, lng: 139.013 }, { name: '越後湯沢', lat: 36.937, lng: 138.811 },
      { name: '新潟', lat: 37.913, lng: 139.061 },
    ],
  },
  {
    id: 'hokuriku', name: '北陸新幹線', operator: 'JR東日本 / JR西日本',
    reservationName: 'えきねっと', reservationUrl: 'https://www.eki-net.com/',
    stations: [
      { name: '東京', lat: 35.681, lng: 139.767 }, { name: '大宮', lat: 35.906, lng: 139.624 },
      { name: '高崎', lat: 36.323, lng: 139.013 }, { name: '長野', lat: 36.643, lng: 138.189 },
      { name: '富山', lat: 36.701, lng: 137.214 }, { name: '金沢', lat: 36.578, lng: 136.648 },
      { name: '福井', lat: 36.063, lng: 136.221 }, { name: '敦賀', lat: 35.645, lng: 136.078 },
    ],
  },
  {
    id: 'kyushu', name: '九州新幹線', operator: 'JR九州',
    reservationName: 'JR九州ネット予約', reservationUrl: 'https://train.yoyaku.jrkyushu.co.jp/',
    stations: [
      { name: '博多', lat: 33.590, lng: 130.421 }, { name: '熊本', lat: 32.789, lng: 130.689 },
      { name: '鹿児島中央', lat: 31.583, lng: 130.541 },
    ],
  },
  {
    id: 'nishi-kyushu', name: '西九州新幹線', operator: 'JR九州',
    reservationName: 'JR九州ネット予約', reservationUrl: 'https://train.yoyaku.jrkyushu.co.jp/',
    stations: [
      { name: '武雄温泉', lat: 33.194, lng: 130.020 }, { name: '新大村', lat: 32.918, lng: 129.958 },
      { name: '長崎', lat: 32.752, lng: 129.872 },
    ],
  },
];

// ── 主要空港 ──────────────────────────────────────────────────────────────
const AIRPORTS: Airport[] = [
  { code: 'HND', name: '羽田空港', lat: 35.549, lng: 139.780 },
  { code: 'NRT', name: '成田空港', lat: 35.772, lng: 140.392 },
  { code: 'CTS', name: '新千歳空港', lat: 42.775, lng: 141.692 },
  { code: 'HKD', name: '函館空港', lat: 41.770, lng: 140.822 },
  { code: 'SDJ', name: '仙台空港', lat: 38.140, lng: 140.917 },
  { code: 'ITM', name: '伊丹空港', lat: 34.785, lng: 135.438 },
  { code: 'KIX', name: '関西空港', lat: 34.434, lng: 135.232 },
  { code: 'NGO', name: '中部国際空港', lat: 34.858, lng: 136.805 },
  { code: 'KMQ', name: '小松空港', lat: 36.394, lng: 136.407 },
  { code: 'KIJ', name: '新潟空港', lat: 37.956, lng: 139.121 },
  { code: 'HIJ', name: '広島空港', lat: 34.436, lng: 132.919 },
  { code: 'FUK', name: '福岡空港', lat: 33.585, lng: 130.451 },
  { code: 'KMJ', name: '熊本空港', lat: 32.837, lng: 130.855 },
  { code: 'KOJ', name: '鹿児島空港', lat: 31.803, lng: 130.719 },
  { code: 'NGS', name: '長崎空港', lat: 32.917, lng: 129.914 },
  { code: 'OKA', name: '那覇空港', lat: 26.196, lng: 127.646 },
];

const MIN_TRIP_KM = 150;        // これ未満は近距離とみなしサジェストしない
const STATION_REACH_KM = 130;   // 出発/目的地から新幹線駅がこの距離以内なら利用可とみなす
const FLIGHT_MIN_KM = 400;      // この距離以上なら飛行機も提示

/** 2 点間の直線距離 (km, ハバーサイン)。 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function nearestStation(corridor: Corridor, p: LatLng): { station: Station; km: number } {
  let best = { station: corridor.stations[0]!, km: Infinity };
  for (const station of corridor.stations) {
    const km = haversineKm(p, station);
    if (km < best.km) best = { station, km };
  }
  return best;
}

function nearestAirport(p: LatLng): { airport: Airport; km: number } {
  let best = { airport: AIRPORTS[0]!, km: Infinity };
  for (const airport of AIRPORTS) {
    const km = haversineKm(p, airport);
    if (km < best.km) best = { airport, km };
  }
  return best;
}

/** Google フライト検索 URL (出発/到着空港コードで絞り込み)。 */
function flightSearchUrl(fromCode: string, toCode: string): string {
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(`flights from ${fromCode} to ${toCode}`)}`;
}

/**
 * 出発地点 origin から目的地 dest への予約サジェストを返す (新幹線/飛行機)。
 * - 新幹線: origin・dest 双方が STATION_REACH_KM 内に駅を持つコリドーを選ぶ
 *   (両端の最寄り駅距離の和が最小のコリドー = 実際に乗る路線)。
 * - 飛行機: 直線距離が FLIGHT_MIN_KM 以上、または新幹線が使えない時、最寄り空港ペアで提示。
 */
export function suggestForLeg(origin: LatLng, dest: LatLng): ReservationSuggestion[] {
  const distance = Math.round(haversineKm(origin, dest));
  if (distance < MIN_TRIP_KM) return [];

  const out: ReservationSuggestion[] = [];

  // 新幹線: 両端が届くコリドーの中から、両端最寄り駅距離の和が最小のものを選ぶ。
  let bestCorridor: { c: Corridor; from: Station; to: Station; score: number } | null = null;
  for (const c of CORRIDORS) {
    const o = nearestStation(c, origin);
    const d = nearestStation(c, dest);
    if (o.km > STATION_REACH_KM || d.km > STATION_REACH_KM) continue;
    if (o.station.name === d.station.name) continue; // 同一駅は移動にならない
    const score = o.km + d.km;
    if (!bestCorridor || score < bestCorridor.score) {
      bestCorridor = { c, from: o.station, to: d.station, score };
    }
  }
  if (bestCorridor) {
    const { c, from, to } = bestCorridor;
    out.push({
      mode: 'shinkansen', title: c.name, operator: c.operator,
      from: `${from.name}駅`, to: `${to.name}駅`,
      url: c.reservationUrl,
      note: `予約: ${c.reservationName}`,
      distance_km: distance,
    });
  }

  // 飛行機: 長距離、または新幹線が使えない時。最寄り空港ペア。
  if (distance >= FLIGHT_MIN_KM || !bestCorridor) {
    const fa = nearestAirport(origin);
    const ta = nearestAirport(dest);
    if (fa.airport.code !== ta.airport.code) {
      out.push({
        mode: 'flight', title: '飛行機', operator: `${fa.airport.name} → ${ta.airport.name}`,
        from: `${fa.airport.name} (${fa.airport.code})`, to: `${ta.airport.name} (${ta.airport.code})`,
        url: flightSearchUrl(fa.airport.code, ta.airport.code),
        note: '予約: フライト検索 (各航空会社)',
        distance_km: distance,
      });
    }
  }

  return out;
}
