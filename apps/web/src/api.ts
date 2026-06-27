// spec/interface/api.md に厳密一致する薄い HTTP クライアント。
// API ベースは VITE_API_BASE (未設定なら 127.0.0.1:8090 を直叩き / dev は proxy も可)。

import type {
  HomeLocation,
  ImageAnalysis,
  ItineraryItem,
  ItineraryItemKind,
  MapConfig,
  OriginKind,
  Place,
  PlaceImage,
  PlaceJob,
  PlaceJobKind,
  PlaceJobView,
  PlaceLink,
  PlaceSearchResult,
  PlaceStatus,
  RouteLeg,
  RouteMode,
  ServiceAlert,
  Timetable,
  TimetableDeparture,
  TimetableKind,
  TransitProviderKind,
  Trip,
  TripDay,
  TripDetail,
  TripPlace,
} from './types.js';

// 既定は同一オリジン (相対)。dev は vite proxy が /api・/uploads を server:8090 へ中継し、
// 本番は server 自身が web/dist を配信するため、どちらも相対で通る。
// 別オリジンの server を叩く場合のみ VITE_API_BASE に絶対 URL を入れる。
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '';

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
  // 200 でも HTML 等が返ることがある (古いサーバが SPA フォールバックを返す等)。
  // res.json() の「Unexpected token '<'」を分かりやすいエラーに変える ([[feedback_no_silent_fallback]])。
  const ctype = res.headers.get('content-type') ?? '';
  if (!ctype.includes('application/json')) {
    const text = await res.text();
    throw new ApiError(
      `API が JSON 以外を返しました (HTTP ${res.status}, content-type: ${ctype || '不明'})。サーバが古い可能性があります（再起動/再デプロイしてください）。`,
      res.status,
      text.slice(0, 200),
    );
  }
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
    input: Partial<Pick<Trip, 'title' | 'start_date' | 'end_date' | 'notes' | 'cover_image_path' | 'archived'>>,
  ) => req<Trip>(`/api/trips/${id}`, { method: 'PATCH', body: json(input) }),
  deleteTrip: (id: string) => req<{ ok: true }>(`/api/trips/${id}`, { method: 'DELETE' }),
  /** 出発地点 (自宅/集合地点) を設定。home は設定ページの自宅、meeting は住所をジオコーディング。 */
  setTripOrigin: (id: string, input: { kind: OriginKind; address?: string; label?: string }) =>
    req<Trip>(`/api/trips/${id}/origin`, { method: 'PUT', body: json(input) }),

  // --- 自宅 (旅をまたいで使い回す出発地点) ---
  getHome: () => req<HomeLocation | null>('/api/settings/home'),
  setHome: (address: string) =>
    req<HomeLocation>('/api/settings/home', { method: 'PUT', body: json({ address }) }),
  deleteHome: () => req<{ ok: true }>('/api/settings/home', { method: 'DELETE' }),

  // --- days (日程は旅の開始日〜終了日から自動生成。手動追加 API は廃止) ---
  listDays: (tripId: string) => req<TripDay[]>(`/api/trips/${tripId}/days`),
  patchDay: (id: string, input: Partial<Pick<TripDay, 'date' | 'title' | 'notes'>>) =>
    req<TripDay>(`/api/days/${id}`, { method: 'PATCH', body: json(input) }),
  deleteDay: (id: string) => req<{ ok: true }>(`/api/days/${id}`, { method: 'DELETE' }),

  // --- places (= 場所ライブラリ / 旅メンバーシップ) ---
  listPlaces: (tripId: string) => req<TripPlace[]>(`/api/trips/${tripId}/places`),
  /** 場所ライブラリ (全旅共有)。status/q で絞り込み。 */
  listLibrary: (params: { status?: string; q?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.q) qs.set('q', params.q);
    const s = qs.toString();
    return req<Place[]>(`/api/places${s ? `?${s}` : ''}`);
  },
  /** 旅に場所を追加 (place_id 指定で既存ライブラリ場所を紐付け、無ければ新規作成)。 */
  addPlaceToTrip: (
    tripId: string,
    input: {
      place_id?: string;
      name?: string; address?: string; lat?: number; lng?: number;
      category?: string; source_url?: string; notes?: string; image_url?: string;
      status?: PlaceStatus; is_base?: number;
    },
  ) => req<TripPlace>(`/api/trips/${tripId}/places`, { method: 'POST', body: json(input) }),
  /** 場所そのもの (ライブラリ) を編集。status もここ。 */
  patchPlace: (
    id: string,
    input: Partial<Pick<Place, 'name' | 'address' | 'lat' | 'lng' | 'category' | 'source_url' | 'summary' | 'notes' | 'image_url' | 'status'>>,
  ) => req<Place>(`/api/places/${id}`, { method: 'PATCH', body: json(input) }),
  /** この旅での拠点フラグ切替 (メンバーシップ)。 */
  setTripBase: (tripId: string, placeId: string, is_base: number) =>
    req<TripPlace>(`/api/trips/${tripId}/places/${placeId}`, { method: 'PATCH', body: json({ is_base }) }),
  /** この旅でのメンバーシップ更新 (拠点ホテルの IN/OUT 時刻 / また今度フラグなど)。 */
  patchTripPlace: (
    tripId: string, placeId: string,
    input: { is_base?: number; checkin_time?: string | null; checkout_time?: string | null; postponed?: number },
  ) => req<TripPlace>(`/api/trips/${tripId}/places/${placeId}`, { method: 'PATCH', body: json(input) }),
  /** 「また今度」フラグ切替 (旅ごと。場所リストから隔離する)。 */
  setPostponed: (tripId: string, placeId: string, postponed: boolean) =>
    req<TripPlace>(`/api/trips/${tripId}/places/${placeId}`, { method: 'PATCH', body: json({ postponed: postponed ? 1 : 0 }) }),
  /** 拠点ホテルのチェックイン/アウト時刻を自動取得 (クロール→LLM)。 */
  fetchHotelTimes: (tripId: string, placeId: string) =>
    req<TripPlace>(`/api/trips/${tripId}/places/${placeId}/hotel-times`, { method: 'POST', body: json({}) }),
  /** 旅から外す (場所はライブラリに残る)。 */
  removeFromTrip: (tripId: string, placeId: string) =>
    req<{ ok: true }>(`/api/trips/${tripId}/places/${placeId}`, { method: 'DELETE' }),
  /** ライブラリから完全削除。 */
  deletePlace: (id: string) => req<{ ok: true }>(`/api/places/${id}`, { method: 'DELETE' }),

  // --- place links (資料 Web ページ) ---
  listLinks: (placeId: string) => req<PlaceLink[]>(`/api/places/${placeId}/links`),
  addLink: (placeId: string, input: { url: string; title?: string }) =>
    req<PlaceLink>(`/api/places/${placeId}/links`, { method: 'POST', body: json(input) }),
  deleteLink: (id: string) => req<{ ok: true }>(`/api/links/${id}`, { method: 'DELETE' }),
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
    input: Partial<Pick<ItineraryItem, 'day_id' | 'place_id' | 'planned_time' | 'kind' | 'note' | 'order_index'>>,
  ) => req<ItineraryItem>(`/api/items/${id}`, { method: 'PATCH', body: json(input) }),
  deleteItem: (id: string) => req<{ ok: true }>(`/api/items/${id}`, { method: 'DELETE' }),

  // --- routing ---
  computeRoute: (dayId: string, mode: RouteMode) =>
    req<RouteLeg[]>(`/api/days/${dayId}/route`, { method: 'POST', body: json({ mode }) }),
  getRoute: (dayId: string) => req<RouteLeg[]>(`/api/days/${dayId}/route`),

  // --- 近くのおすすめ収集 (拠点周辺の候補を旅に一括追加) ---
  recommendTrip: (tripId: string, body: { radius?: number } = {}) =>
    req<{ added: TripPlace[] }>(`/api/trips/${tripId}/recommend`, { method: 'POST', body: json(body) }),

  // --- Web から代表画像を取得 (place.image_url を埋める) ---
  imageFromWeb: (placeId: string) =>
    req<Place>(`/api/places/${placeId}/image-from-web`, { method: 'POST', body: json({}) }),

  // --- 拠点サマリー生成 (place.summary を埋める) ---
  summarizeBase: (placeId: string) =>
    req<Place>(`/api/places/${placeId}/summarize-base`, { method: 'POST', body: json({}) }),

  // --- 時刻表 (区間ボード + 便) ---
  listTimetables: (tripId: string) => req<Timetable[]>(`/api/trips/${tripId}/timetables`),
  createTimetable: (
    tripId: string,
    input: { kind: TimetableKind; line_name?: string; from_station?: string; to_station?: string; notes?: string },
  ) => req<Timetable>(`/api/trips/${tripId}/timetables`, { method: 'POST', body: json(input) }),
  deleteTimetable: (id: string) => req<{ ok: true }>(`/api/timetables/${id}`, { method: 'DELETE' }),
  listDepartures: (timetableId: string) =>
    req<TimetableDeparture[]>(`/api/timetables/${timetableId}/departures`),
  addDeparture: (
    timetableId: string,
    input: { depart_time?: string; arrive_time?: string; train_name?: string; platform?: string; fare_text?: string; note?: string },
  ) => req<TimetableDeparture>(`/api/timetables/${timetableId}/departures`, { method: 'POST', body: json(input) }),
  deleteDeparture: (id: string) => req<{ ok: true }>(`/api/departures/${id}`, { method: 'DELETE' }),
  /** 利用可能な取得プロバイダ (crawl-llm 常時 / ekispert はキー設定時)。 */
  getTransitConfig: () =>
    req<{ providers: TransitProviderKind[]; default: TransitProviderKind; ekispertEnabled: boolean }>(
      '/api/transit/config',
    ),
  /** 便の自動取得。crawl-llm は url 必須、ekispert は区間 from/to を使用。 */
  fetchTimetable: (
    timetableId: string,
    opts: { provider?: TransitProviderKind; url?: string; date?: string } = {},
  ) =>
    req<{ provider: string; added: number; departures: TimetableDeparture[] }>(
      `/api/timetables/${timetableId}/fetch`,
      { method: 'POST', body: json(opts) },
    ),

  // --- 取り込みジョブ (画像解析/クロールの順次処理キュー) ---
  /** ジョブを積む。is_new_place=true は取り込みで新規作成したドラフト place (成立まで一覧に出さない)。 */
  createJob: (
    tripId: string,
    input: { place_id: string; kind: PlaceJobKind; source_url?: string; is_new_place?: boolean },
  ) => req<PlaceJob>(`/api/trips/${tripId}/jobs`, {
    method: 'POST',
    body: json({ ...input, is_new_place: input.is_new_place ? 1 : 0 }),
  }),
  listJobs: (tripId: string) => req<PlaceJobView[]>(`/api/trips/${tripId}/jobs`),
  retryJob: (id: string) => req<PlaceJob>(`/api/jobs/${id}/retry`, { method: 'POST', body: json({}) }),
  deleteJob: (id: string) => req<{ ok: true }>(`/api/jobs/${id}`, { method: 'DELETE' }),

  // --- 運行情報 ---
  listServiceAlerts: (tripId: string) => req<ServiceAlert[]>(`/api/trips/${tripId}/service-alerts`),
  addServiceAlert: (
    tripId: string,
    input: { line_name?: string; severity?: string; title?: string; body?: string; source_url?: string },
  ) => req<ServiceAlert>(`/api/trips/${tripId}/service-alerts`, { method: 'POST', body: json(input) }),
  deleteServiceAlert: (id: string) => req<{ ok: true }>(`/api/service-alerts/${id}`, { method: 'DELETE' }),
  /** 運行情報の更新。crawl-llm は url 必須 (ekispert は運行情報未対応で 501)。 */
  refreshServiceAlerts: (
    tripId: string,
    opts: { provider?: TransitProviderKind; url?: string; line_name?: string } = {},
  ) =>
    req<{ provider: string; added: number; alerts: ServiceAlert[] }>(
      `/api/trips/${tripId}/service-alerts/refresh`,
      { method: 'POST', body: json(opts) },
    ),
};
