// Google Routes API (Compute Routes) のラッパー。server 非依存。
// API キー無しは silent fallback せず即 throw する ([[feedback_no_silent_fallback]])。
// fetch は Node22 グローバル fetch を使う。

export type RouteMode = 'driving' | 'walking' | 'transit' | 'bicycling';

export interface ComputeRouteOptions {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  mode: RouteMode;
  /** transit 用の出発時刻 (RFC3339)。未指定なら「今+1分」。過去は不可。 */
  departureTime?: string;
}

export interface ComputeRouteResult {
  duration_sec: number | null;
  distance_m: number | null;
  polyline: string | null;
  fare_text: string | null;
  raw: unknown;
}

const COMPUTE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

// アプリの mode → Routes API travelMode。
const TRAVEL_MODE: Record<RouteMode, string> = {
  driving: 'DRIVE',
  walking: 'WALK',
  transit: 'TRANSIT',
  bicycling: 'BICYCLE',
};

// Routes API レスポンスの必要部分。
interface TransitFare {
  currencyCode?: string;
  units?: string | number; // int64 は string で来る
  nanos?: number;
}

interface ComputeRoutesResponse {
  routes?: Array<{
    duration?: string; // "123s"
    distanceMeters?: number;
    polyline?: { encodedPolyline?: string };
    travelAdvisory?: { transitFare?: TransitFare };
  }>;
}

/** "123s" 形式の duration を秒数に変換する。失敗時は null。 */
function parseDurationSec(d: string | undefined): number | null {
  if (!d) return null;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(d.trim());
  if (!m) {
    const n = Number(d);
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  return Math.round(Number(m[1]));
}

/** transitFare (Money) を人間可読な運賃文字列にする。無ければ null。 */
function formatFare(fare: TransitFare | undefined): string | null {
  if (!fare) return null;
  const units = fare.units != null ? Number(fare.units) : 0;
  const nanos = fare.nanos ?? 0;
  const amount = units + nanos / 1e9;
  if (!Number.isFinite(amount)) return null;
  const currency = fare.currencyCode ?? '';
  if (currency === 'JPY' || currency === '') {
    return `¥${Math.round(amount).toLocaleString('ja-JP')}`;
  }
  return `${currency} ${amount.toLocaleString('ja-JP')}`;
}

/**
 * Google Routes API で 2 点間の経路を計算する。
 * @throws apiKey が空のとき
 */
export async function computeRoute(
  opts: ComputeRouteOptions,
  apiKey: string,
): Promise<ComputeRouteResult> {
  if (!apiKey) {
    throw new Error('computeRoute: Google Maps API キーが未設定です (apiKey が空)');
  }

  const body: Record<string, unknown> = {
    origin: {
      location: { latLng: { latitude: opts.from.lat, longitude: opts.from.lng } },
    },
    destination: {
      location: { latLng: { latitude: opts.to.lat, longitude: opts.to.lng } },
    },
    travelMode: TRAVEL_MODE[opts.mode],
    languageCode: 'ja',
  };
  // TRANSIT は departureTime を指定しないと経路が返らないことがある。
  // 指定が無ければ「今 + 1 分」(過去は不可) を既定にする。
  if (opts.mode === 'transit') {
    body.departureTime = opts.departureTime ?? new Date(Date.now() + 60_000).toISOString();
  }

  const res = await fetch(COMPUTE_ROUTES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask':
        'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.travelAdvisory.transitFare',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`computeRoute: Routes API がエラーを返しました (${res.status}): ${text}`);
  }

  const data = (await res.json()) as ComputeRoutesResponse;
  const route = data.routes?.[0];
  if (!route) {
    return { duration_sec: null, distance_m: null, polyline: null, fare_text: null, raw: data };
  }

  return {
    duration_sec: parseDurationSec(route.duration),
    distance_m: route.distanceMeters ?? null,
    polyline: route.polyline?.encodedPolyline ?? null,
    fare_text: formatFare(route.travelAdvisory?.transitFare),
    raw: data,
  };
}
