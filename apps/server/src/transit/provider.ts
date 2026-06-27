// 時刻表 / 運行情報の取得プロバイダ抽象。
//   - 'crawl-llm' : 時刻表/運行情報ページの URL をクロール → LLM (claude CLI) で抽出。契約・キー不要。
//   - 'ekispert'  : 駅すぱあと(Ekispert) Web サービス。契約 API キー登録時のみ有効化。
// 閉じた provider 集合なので factory + switch で十分 ([[feedback_ocp_closed_enum_switch]])。
// 未配線/入力不足/取得失敗は silent fallback せず、種別ごとの明示エラーにする
// ([[feedback_no_silent_fallback]] / [[feedback_no_error_swallow]])。

import type { TimetableKind } from '../types.js';

/** 抽出した便 1 本 (DB 挿入前の純データ)。時刻は 'HH:MM'、無ければ null。 */
export interface DepartureExtract {
  depart_time: string | null;
  arrive_time: string | null;
  train_name: string | null;
  platform: string | null;
  fare_text: string | null;
  note: string | null;
}

/** 抽出した運行情報 1 件。severity は 'normal'|'info'|'warning'|'suspended'。 */
export interface AlertExtract {
  line_name: string | null;
  severity: string;
  title: string | null;
  body: string | null;
  source_url: string | null;
}

/** fetch (便) 要求の文脈。区間情報は timetable 行から来る。 */
export interface DepartureRequest {
  kind: TimetableKind;
  line_name: string | null;
  from_station: string | null;
  to_station: string | null;
  /** crawl-llm: クロール対象の時刻表ページ URL。 */
  url?: string | null;
  /** ekispert: 検索日 'YYYY-MM-DD' (省略時はプロバイダ既定の当日扱い)。 */
  date?: string | null;
}

/** refresh (運行情報) 要求の文脈。 */
export interface AlertRequest {
  line_name: string | null;
  /** crawl-llm: クロール対象の運行情報ページ URL。 */
  url?: string | null;
}

export type ProviderKind = 'crawl-llm' | 'ekispert';

export const PROVIDER_KINDS: readonly ProviderKind[] = ['crawl-llm', 'ekispert'];

/** プロバイダが利用不可 (未配線/未対応)。route 側で 501 に対応づける。 */
export class ProviderUnavailableError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

/** 入力不足 (URL 必須・区間未設定など)。route 側で 400 に対応づける。 */
export class ProviderInputError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message);
    this.name = 'ProviderInputError';
  }
}

/** 外部取得 (クロール/HTTP) 失敗。route 側で 502 に対応づける。 */
export class ProviderFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderFetchError';
  }
}

/** 時刻表/運行情報の取得プロバイダ。実装: crawl-llm / ekispert。 */
export interface TransitProvider {
  readonly kind: ProviderKind;
  readonly supportsDepartures: boolean;
  readonly supportsAlerts: boolean;
  fetchDepartures(req: DepartureRequest): Promise<DepartureExtract[]>;
  fetchAlerts(req: AlertRequest): Promise<AlertExtract[]>;
}
