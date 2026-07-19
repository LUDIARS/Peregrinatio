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
  ReservationSuggestionsResult,
  PlaceStatus,
  RouteLeg,
  RouteMode,
  ServiceAlert,
  ShinkansenBusSuggestionsResult,
  Timetable,
  TimetableDeparture,
  TimetableKind,
  TripCheckItem,
  TripCheckListType,
  TransitOption,
  TransitProviderKind,
  GtfsFeed,
  GtfsStopHit,
  GtfsDeparture,
  GtfsRoute,
  GtfsRouteTimetable,
  GtfsTimetableStop,
  RouteSearchResult,
  RouteSummary,
  Trip,
  TripDay,
  TripDetail,
  TripPlace,
  PlaceFacility,
  SharedTripAccess,
  SharedTripSummary,
  TripShareConfig,
} from './types.js';

import { currentUserName } from './lib/prefs.js';

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
  // 複数人編集の表示名。日本語も入りうるので encode して ASCII ヘッダにする。
  try {
    const u = currentUserName();
    if (u) headers['x-pe-user'] = encodeURIComponent(u);
  } catch { /* prefs 未準備時は付けない */ }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    // body ストリームは 1 度しか読めない。res.json() 失敗後に res.text() を呼ぶと
    // 「Body is disturbed or locked」で本当のエラーが握り潰されるため、必ず text で
    // 一度だけ読んでから JSON.parse を試す。
    const raw = await res.text().catch(() => '');
    let body: unknown = raw;
    try { body = raw ? JSON.parse(raw) : undefined; } catch { /* JSON でなければ raw 文字列のまま */ }
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
  getTripShare: (id: string) => req<TripShareConfig | null>(`/api/trips/${id}/share`),
  configureTripShare: (id: string, password: string | null) =>
    req<TripShareConfig>(`/api/trips/${id}/share`, { method: 'PUT', body: json({ password }) }),
  inspectSharedTrip: (token: string) => req<SharedTripAccess>(`/api/shares/${encodeURIComponent(token)}`),
  unlockSharedTrip: (token: string, password: string) =>
    req<{ trip: SharedTripSummary }>(`/api/shares/${encodeURIComponent(token)}/unlock`, {
      method: 'POST', body: json({ password }),
    }),
  /** 出発地点 (自宅/集合地点) を設定。home は設定ページの自宅、meeting は住所をジオコーディング。 */
  setTripOrigin: (id: string, input: { kind: OriginKind; address?: string; label?: string }) =>
    req<Trip>(`/api/trips/${id}/origin`, { method: 'PUT', body: json(input) }),

  // --- 自宅 (旅をまたいで使い回す出発地点) ---
  getHome: () => req<HomeLocation | null>('/api/settings/home'),
  /** 自宅を設定。住所 or 現在地座標 (lat/lng) のどちらかを渡す。最寄り駅はサーバが自動取得。 */
  setHome: (input: { address?: string; lat?: number; lng?: number }) =>
    req<HomeLocation>('/api/settings/home', { method: 'PUT', body: json(input) }),
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
  geocodePlace: (id: string, input: { address?: string }) =>
    req<Place>(`/api/places/${id}/geocode`, { method: 'POST', body: json(input) }),
  /** この旅での拠点フラグ切替 (メンバーシップ)。 */
  setTripBase: (tripId: string, placeId: string, is_base: number) =>
    req<TripPlace>(`/api/trips/${tripId}/places/${placeId}`, { method: 'PATCH', body: json({ is_base }) }),
  /** この旅でのメンバーシップ更新 (拠点ホテルの IN/OUT 時刻 / また今度フラグなど)。 */
  patchTripPlace: (
    tripId: string, placeId: string,
    input: { is_base?: number; base_name?: string | null; checkin_time?: string | null; checkout_time?: string | null; postponed?: number },
  ) => req<TripPlace>(`/api/trips/${tripId}/places/${placeId}`, { method: 'PATCH', body: json(input) }),
  listPlaceFacilities: (tripId: string, placeId: string) =>
    req<PlaceFacility[]>(`/api/trips/${tripId}/places/${placeId}/facilities`),
  listTripFacilities: (tripId: string) =>
    req<PlaceFacility[]>(`/api/trips/${tripId}/facilities`),
  suggestPlaceFacilities: (tripId: string, placeId: string) =>
    req<{ place: TripPlace; facilities: PlaceFacility[] }>(
      `/api/trips/${tripId}/places/${placeId}/facilities/suggest`,
      { method: 'POST', body: json({}) },
    ),
  setFacilityWanted: (tripId: string, placeId: string, facilityId: string, wanted: boolean) =>
    req<PlaceFacility>(`/api/trips/${tripId}/places/${placeId}/facilities/${facilityId}`, {
      method: 'PATCH', body: json({ wanted }),
    }),
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
  /** 新規区間の既定手段を mode で渡す。autoPerSegment=true で区間ごと (距離+既定) にサジェスト。
   *  ユーザが個別に選んだ区間 (patchLegMode) は保存済みの手段が優先される。 */
  computeRoute: (dayId: string, mode: RouteMode, autoPerSegment = false) =>
    req<RouteLeg[]>(`/api/days/${dayId}/route`, { method: 'POST', body: json({ mode, autoPerSegment }) }),
  getRoute: (dayId: string) => req<RouteLeg[]>(`/api/days/${dayId}/route`),
  /** 1 区間 (leg) の移動手段だけを変更し、その区間のみ再計算する (他区間に連動しない)。 */
  patchLegMode: (legId: string, mode: RouteMode) =>
    req<RouteLeg>(`/api/legs/${legId}`, { method: 'PATCH', body: json({ mode }) }),
  /** サーバが Google マップの乗換経路を自動取得(ヘッドレス)→解析し、経路候補の配列を返す (暫定)。 */
  transitFetch: (legId: string) =>
    req<{ options: TransitOption[] }>(`/api/legs/${legId}/transit-fetch`, { method: 'POST', body: json({}) }),
  /** Google マップの乗換結果テキストを LLM 解析し、経路候補の配列を返す (自動取得失敗時の手動版)。 */
  transitFromGmaps: (legId: string, text: string) =>
    req<{ options: TransitOption[] }>(`/api/legs/${legId}/transit-from-gmaps`, { method: 'POST', body: json({ text }) }),
  /** 選んだ経路候補をこの区間に確定保存する。 */
  transitSelect: (legId: string, option: TransitOption) =>
    req<RouteLeg>(`/api/legs/${legId}/transit-select`, { method: 'POST', body: json({ option }) }),

  // --- 近くのおすすめ収集 (拠点周辺の候補を旅に一括追加) ---
  recommendTrip: (tripId: string, body: { radius?: number } = {}) =>
    req<{ added: TripPlace[] }>(`/api/trips/${tripId}/recommend`, { method: 'POST', body: json(body) }),

  // --- 自動検索 (情報の無い場所を Google で補完し、公式サイトを取り込みキューに積む) ---
  /** 既存場所の自動検索。位置/住所/カテゴリ/画像/公式リンクを補完し、公式サイトの要約をキュー投入。 */
  autoSearchPlace: (tripId: string, placeId: string) =>
    req<{ place: TripPlace; matched: boolean; queuedCrawl: boolean }>(
      `/api/trips/${tripId}/places/${placeId}/auto-search`,
      { method: 'POST', body: json({}) },
    ),
  /** 地図 POI (Google place id) を旅に追加し、公式情報を自動取得する。 */
  addPlaceFromGoogle: (tripId: string, googlePlaceId: string) =>
    req<{ place: TripPlace; queuedCrawl: boolean }>(
      `/api/trips/${tripId}/places/from-google`,
      { method: 'POST', body: json({ place_id: googlePlaceId }) },
    ),

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
  seedTohokuShinkansen: (tripId: string) =>
    req<{ timetables: Timetable[]; added: number; departures: TimetableDeparture[]; source_url: string }>(
      `/api/trips/${tripId}/timetables/tohoku-shinkansen-seed`,
      { method: 'POST', body: json({}) },
    ),
  suggestBusesForTohokuShinkansen: (tripId: string) =>
    req<ShinkansenBusSuggestionsResult>(
      `/api/trips/${tripId}/timetables/tohoku-shinkansen-bus-suggestions`,
      { method: 'POST', body: json({}) },
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

  // --- 予約サジェスト (新幹線/飛行機) ---
  reservationSuggestions: (tripId: string) =>
    req<ReservationSuggestionsResult>(`/api/trips/${tripId}/reservation-suggestions`),

  // --- GTFS 時刻表 (バス/一部鉄道の一括取込) ---
  /** GTFS zip URL を取り込む (フィード作成。重い)。 */
  gtfsImport: (input: { url: string; name?: string }) =>
    req<GtfsFeed>('/api/gtfs/import', { method: 'POST', body: json(input) }),
  gtfsImportFromPage: (input: { url: string; name?: string }) =>
    req<{ feed: GtfsFeed; source_url: string }>('/api/gtfs/import-from-page', { method: 'POST', body: json(input) }),
  gtfsFeeds: () => req<GtfsFeed[]>('/api/gtfs/feeds'),
  gtfsDeleteFeed: (id: string) => req<{ ok: true }>(`/api/gtfs/feeds/${id}`, { method: 'DELETE' }),
  routeSummaries: () => req<RouteSummary[]>('/api/gtfs/routes'),
  routeSearch: (input: {
    from: { lat: number; lng: number };
    to: { lat: number; lng: number };
    date: string;
    time: string;
    basis: 'departure' | 'arrival';
  }) => req<RouteSearchResult>('/api/gtfs/route-search', { method: 'POST', body: json(input) }),
  /** フィードの路線一覧 (便数つき)。 */
  gtfsRoutes: (feedId: string) => req<GtfsRoute[]>(`/api/gtfs/feeds/${feedId}/routes`),
  /** フィードの全停留所 (1 マップに全部出す用)。 */
  gtfsFeedStops: (feedId: string) => req<GtfsTimetableStop[]>(`/api/gtfs/feeds/${feedId}/stops`),
  /** 路線の時刻表 (指定日に運行する便のみ。停留所=横軸、便=縦軸)。date=YYYYMMDD 省略時=JST今日。 */
  gtfsRouteTimetable: (feedId: string, routeId: string, date?: string) =>
    req<GtfsRouteTimetable>(
      `/api/gtfs/feeds/${feedId}/routes/${encodeURIComponent(routeId)}/timetable${date ? `?date=${date}` : ''}`,
    ),
  /** lat/lng 近傍の停留所 (距離順)。 */
  gtfsNearbyStops: (params: { lat: number; lng: number; radius?: number; limit?: number }) => {
    const qs = new URLSearchParams({ lat: String(params.lat), lng: String(params.lng) });
    if (params.radius != null) qs.set('radius', String(params.radius));
    if (params.limit != null) qs.set('limit', String(params.limit));
    return req<GtfsStopHit[]>(`/api/gtfs/stops/nearby?${qs.toString()}`);
  },
  /** 停留所の発車時刻ボード (date=YYYYMMDD / after=HH:MM:SS は省略時サーバが今=JST)。 */
  gtfsDepartures: (feedId: string, stopId: string, params: { date?: string; after?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.date) qs.set('date', params.date);
    if (params.after) qs.set('after', params.after);
    if (params.limit != null) qs.set('limit', String(params.limit));
    const s = qs.toString();
    return req<GtfsDeparture[]>(`/api/gtfs/feeds/${feedId}/stops/${encodeURIComponent(stopId)}/departures${s ? `?${s}` : ''}`);
  },

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

  // --- 旅の準備: 持ち物 / TODO ---
  listCheckItems: (tripId: string, listType?: TripCheckListType) =>
    req<TripCheckItem[]>(
      `/api/trips/${tripId}/check-items${listType ? `?list_type=${encodeURIComponent(listType)}` : ''}`,
    ),
  createCheckItem: (
    tripId: string,
    input: Pick<TripCheckItem, 'list_type' | 'title'> & Partial<Pick<TripCheckItem, 'details' | 'status' | 'quantity' | 'category' | 'due_at'>>,
  ) => req<TripCheckItem>(`/api/trips/${tripId}/check-items`, { method: 'POST', body: json(input) }),
  patchCheckItem: (
    id: string,
    input: Partial<Pick<TripCheckItem, 'title' | 'details' | 'status' | 'quantity' | 'category' | 'due_at' | 'order_index'>>,
  ) => req<TripCheckItem>(`/api/check-items/${id}`, { method: 'PATCH', body: json(input) }),
  deleteCheckItem: (id: string) => req<{ ok: true }>(`/api/check-items/${id}`, { method: 'DELETE' }),
};
