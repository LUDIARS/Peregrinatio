// spec/interface/api.md に厳密一致する薄い HTTP クライアント。
// API ベースは VITE_API_BASE (未設定なら 127.0.0.1:8090 を直叩き / dev は proxy も可)。

import type {
  ImageAnalysis,
  ItineraryItem,
  ItineraryItemKind,
  MapConfig,
  Place,
  PlaceImage,
  PlaceSearchResult,
  RouteLeg,
  RouteMode,
  Trip,
  TripDay,
  TripDetail,
} from './types.js';

export const API_BASE: string = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8090';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly body?: unknown) {
    super(message);
  }
}

/** uploads/... 等のサーバ相対パスを絶対 URL にする (画像 src 用)。 */
export function assetUrl(path: string): string {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE}/${path.replace(/^\//, '')}`;
}

/** /api/trips/:id/pdf を新規タブで開くための絶対 URL。 */
export function pdfUrl(tripId: string): string {
  return `${API_BASE}/api/trips/${encodeURIComponent(tripId)}/pdf`;
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  // multipart のときは content-type をブラウザに任せる (boundary 付与のため)。
  const isForm = init.body instanceof FormData;
  if (!isForm && init.body != null) headers['content-type'] = 'application/json';

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    let body: unknown;
    try { body = await res.json(); } catch { body = await res.text(); }
    const msg = (body && typeof body === 'object' && 'error' in body)
      ? String((body as { error: unknown }).error)
      : `HTTP ${res.status} ${res.statusText}`;
    throw new ApiError(msg, res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (data: unknown) => JSON.stringify(data);

export const api = {
  // --- 設定 / 地図 ---
  mapConfig: () => req<MapConfig>('/api/map-config'),

  // --- trips ---
  listTrips: () => req<Trip[]>('/api/trips'),
  createTrip: (input: { title: string; start_date?: string; end_date?: string; notes?: string }) =>
    req<Trip>('/api/trips', { method: 'POST', body: json(input) }),
  getTrip: (id: string) => req<TripDetail>(`/api/trips/${id}`),
  patchTrip: (
    id: string,
    input: Partial<Pick<Trip, 'title' | 'start_date' | 'end_date' | 'notes' | 'cover_image_path'>>,
  ) => req<Trip>(`/api/trips/${id}`, { method: 'PATCH', body: json(input) }),
  deleteTrip: (id: string) => req<{ ok: true }>(`/api/trips/${id}`, { method: 'DELETE' }),

  // --- days ---
  listDays: (tripId: string) => req<TripDay[]>(`/api/trips/${tripId}/days`),
  createDay: (tripId: string, input: { date?: string; title?: string; notes?: string }) =>
    req<TripDay>(`/api/trips/${tripId}/days`, { method: 'POST', body: json(input) }),
  patchDay: (id: string, input: Partial<Pick<TripDay, 'date' | 'title' | 'notes'>>) =>
    req<TripDay>(`/api/days/${id}`, { method: 'PATCH', body: json(input) }),
  deleteDay: (id: string) => req<{ ok: true }>(`/api/days/${id}`, { method: 'DELETE' }),

  // --- places (= ピン) ---
  listPlaces: (tripId: string) => req<Place[]>(`/api/trips/${tripId}/places`),
  createPlace: (
    tripId: string,
    input: {
      name: string;
      address?: string;
      lat?: number;
      lng?: number;
      category?: string;
      source_url?: string;
      notes?: string;
    },
  ) => req<Place>(`/api/trips/${tripId}/places`, { method: 'POST', body: json(input) }),
  patchPlace: (
    id: string,
    input: Partial<Pick<Place, 'name' | 'address' | 'lat' | 'lng' | 'category' | 'source_url' | 'summary' | 'notes' | 'pinned'>>,
  ) => req<Place>(`/api/places/${id}`, { method: 'PATCH', body: json(input) }),
  deletePlace: (id: string) => req<{ ok: true }>(`/api/places/${id}`, { method: 'DELETE' }),
  crawlPlace: (id: string, input: { url?: string } = {}) =>
    req<Place>(`/api/places/${id}/crawl`, { method: 'POST', body: json(input) }),
  searchPlaces: (params: { q?: string; lat?: number; lng?: number; radius?: number }) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.lat != null) qs.set('lat', String(params.lat));
    if (params.lng != null) qs.set('lng', String(params.lng));
    if (params.radius != null) qs.set('radius', String(params.radius));
    return req<PlaceSearchResult[]>(`/api/places/search?${qs.toString()}`);
  },

  // --- place images ---
  uploadImages: (placeId: string, files: File[]) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f, f.name);
    return req<PlaceImage[]>(`/api/places/${placeId}/images`, { method: 'POST', body: fd });
  },
  listImages: (placeId: string) => req<PlaceImage[]>(`/api/places/${placeId}/images`),
  composeImages: (placeId: string, order: 'rtl' | 'ltr' = 'rtl') =>
    req<PlaceImage>(`/api/places/${placeId}/images/compose`, { method: 'POST', body: json({ order }) }),
  analyzeImage: (imageId: string) =>
    req<ImageAnalysis>(`/api/images/${imageId}/analyze`, { method: 'POST', body: json({}) }),

  // --- itinerary ---
  listItems: (dayId: string) => req<ItineraryItem[]>(`/api/days/${dayId}/items`),
  createItem: (
    dayId: string,
    input: { place_id?: string; planned_time?: string; kind: ItineraryItemKind; note?: string },
  ) => req<ItineraryItem>(`/api/days/${dayId}/items`, { method: 'POST', body: json(input) }),
  patchItem: (
    id: string,
    input: Partial<Pick<ItineraryItem, 'place_id' | 'planned_time' | 'kind' | 'note' | 'order_index'>>,
  ) => req<ItineraryItem>(`/api/items/${id}`, { method: 'PATCH', body: json(input) }),
  deleteItem: (id: string) => req<{ ok: true }>(`/api/items/${id}`, { method: 'DELETE' }),

  // --- routing ---
  computeRoute: (dayId: string, mode: RouteMode) =>
    req<RouteLeg[]>(`/api/days/${dayId}/route`, { method: 'POST', body: json({ mode }) }),
  getRoute: (dayId: string) => req<RouteLeg[]>(`/api/days/${dayId}/route`),
};
