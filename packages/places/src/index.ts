// Google Places (New) Text Search と Geocoding のラッパー。
// この package は server 非依存 (型はローカル定義)。API キー無しは silent fallback せず即 throw する
// ([[feedback_no_silent_fallback]] / [[feedback_no_env_fallback_for_secrets]])。
// fetch は Node22 グローバル fetch を使う。

/** 検索結果 1 件。apps/server/src/types.ts の PlaceSearchResult と同形 (server 非依存のためローカル定義)。 */
export type PlaceSearchResult = {
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  place_id: string;
  category?: string | null;
};

export interface SearchPlacesOptions {
  q: string;
  lat?: number;
  lng?: number;
  /** locationBias.circle の半径 (m)。lat/lng 指定時のみ使用。未指定は 5000m。 */
  radius?: number;
}

// Places API (New) Text Search レスポンスの必要部分。
interface TextSearchResponse {
  places?: Array<{
    id?: string;
    displayName?: { text?: string; languageCode?: string };
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
    primaryType?: string;
  }>;
}

const PLACES_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

/**
 * Google Places API (New) Text Search で施設を検索する。
 * lat/lng があれば locationBias.circle で近傍を優先する。
 * @throws apiKey が空のとき
 */
export async function searchPlaces(
  opts: SearchPlacesOptions,
  apiKey: string,
): Promise<PlaceSearchResult[]> {
  if (!apiKey) {
    throw new Error('searchPlaces: Google Maps API キーが未設定です (apiKey が空)');
  }

  const body: Record<string, unknown> = {
    textQuery: opts.q,
    languageCode: 'ja',
  };
  if (opts.lat != null && opts.lng != null) {
    body.locationBias = {
      circle: {
        center: { latitude: opts.lat, longitude: opts.lng },
        radius: opts.radius ?? 5000,
      },
    };
  }

  const res = await fetch(PLACES_TEXT_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`searchPlaces: Places API がエラーを返しました (${res.status}): ${text}`);
  }

  const data = (await res.json()) as TextSearchResponse;
  const places = data.places ?? [];
  return places.map((p) => ({
    name: p.displayName?.text ?? '',
    address: p.formattedAddress ?? null,
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    place_id: p.id ?? '',
    category: p.primaryType ?? null,
  }));
}

// Geocoding API レスポンスの必要部分。
interface GeocodeResponse {
  status?: string;
  results?: Array<{
    geometry?: { location?: { lat?: number; lng?: number } };
  }>;
}

/**
 * 住所文字列を緯度経度に変換する。結果 0 件は null。
 * @throws apiKey が空のとき
 */
export async function geocode(
  address: string,
  apiKey: string,
): Promise<{ lat: number; lng: number } | null> {
  if (!apiKey) {
    throw new Error('geocode: Google Maps API キーが未設定です (apiKey が空)');
  }

  const url = `${GEOCODE_URL}?address=${encodeURIComponent(address)}&language=ja&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`geocode: Geocoding API がエラーを返しました (${res.status}): ${text}`);
  }

  const data = (await res.json()) as GeocodeResponse;
  const first = data.results?.[0];
  const loc = first?.geometry?.location;
  if (!loc || loc.lat == null || loc.lng == null) return null;
  return { lat: loc.lat, lng: loc.lng };
}
