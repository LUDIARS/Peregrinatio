// ekispert プロバイダ: 駅すぱあと(Ekispert) Web サービスの経路探索で区間の便候補を取得する。
// 契約 API キー (EKISPERT_API_KEY) 登録時のみ有効化 (factory で未設定なら明示エラー)。
//
// 注意: Ekispert の JSON 応答の細部 (配列 or 単体・時刻表記) は契約キーでの実走で要検証。
// 応答→DepartureExtract の写像 (mapEkispertDepartures) を純関数に分離し、構造変化に
// 強い防御的マップ + 単体テストで担保する。エンドポイント: /search/course/extreme。

import type { Config } from '../config.js';
import { normTime } from './parse.js';
import {
  type AlertExtract,
  type AlertRequest,
  type DepartureExtract,
  type DepartureRequest,
  type TransitProvider,
  ProviderFetchError,
  ProviderInputError,
  ProviderUnavailableError,
} from './provider.js';

/** Ekispert の配列フィールドは要素 1 個だと単体オブジェクトで来るため常に配列化する。 */
function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v === null || v === undefined) return [];
  return [v];
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/** Departure/Arrival ノードから 'HH:MM' を取り出す。string / {text} / {Datetime:{text}} を許容。 */
function pickTime(node: unknown): string | null {
  if (typeof node === 'string') {
    const direct = normTime(node);
    if (direct) return direct;
    const m = node.match(/T(\d{2}:\d{2})/); // ISO datetime "...T08:00:00"
    if (m) return normTime(m[1]);
    return null;
  }
  const r = rec(node);
  if (typeof r.text === 'string') return pickTime(r.text);
  if (r.Datetime) return pickTime(r.Datetime);
  return null;
}

/** Price ノードから運賃文字列を組み立てる。Oneway 金額があれば「¥N」。 */
function pickFare(price: unknown): string | null {
  for (const p of asArray(price)) {
    const r = rec(p);
    const kind = typeof r.kind === 'string' ? r.kind : '';
    if (kind && kind !== 'Fare') continue;
    const oneway = r.Oneway ?? r.oneway;
    const n = typeof oneway === 'string' ? oneway : typeof oneway === 'number' ? String(oneway) : null;
    if (n) return `¥${n}`;
  }
  return null;
}

/**
 * Ekispert 経路探索応答 → DepartureExtract[] (純関数, テスト対象)。
 * 各 Course の乗車区間 (Route.Line[]) の先頭発・末尾着を 1 便として写す。
 */
export function mapEkispertDepartures(json: unknown): DepartureExtract[] {
  const rs = rec(rec(json).ResultSet);
  const out: DepartureExtract[] = [];
  for (const course of asArray(rs.Course)) {
    const route = rec(rec(course).Route);
    const lines = asArray(route.Line).map(rec);
    const first = lines[0] ?? {};
    const last = lines[lines.length - 1] ?? first;
    const depart = pickTime(first.Departure ?? route.Departure);
    const arrive = pickTime(last.Arrival ?? route.Arrival);
    if (!depart && !arrive) continue;
    const name =
      (typeof first.Name === 'string' && first.Name) ||
      (typeof first.TypeName === 'string' && first.TypeName) ||
      null;
    const platform = rec(first.StartPlatform).Name;
    out.push({
      depart_time: depart,
      arrive_time: arrive,
      train_name: name,
      platform: typeof platform === 'string' ? platform : null,
      fare_text: pickFare(rec(course).Price),
      note: null,
    });
  }
  return out;
}

export class EkispertProvider implements TransitProvider {
  readonly kind = 'ekispert' as const;
  readonly supportsDepartures = true;
  readonly supportsAlerts = false; // 運行情報は別契約 API。未対応を明示し crawl-llm を促す。

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly fetchTimeoutMs: number,
  ) {}

  async fetchDepartures(req: DepartureRequest): Promise<DepartureExtract[]> {
    const from = (req.from_station ?? '').trim();
    const to = (req.to_station ?? '').trim();
    if (!from || !to) {
      throw new ProviderInputError(
        'ekispert は出発駅 (from_station) と到着駅 (to_station) が必要です',
        '時刻表ボードの from/to を設定してから取得してください。',
      );
    }
    const params = new URLSearchParams({
      key: this.apiKey,
      viaList: `${from}:${to}`,
      searchType: 'departure',
    });
    if (req.date) params.set('date', req.date.replace(/-/g, '')); // 'YYYY-MM-DD' → 'YYYYMMDD'
    const url = `${this.baseUrl}/search/course/extreme?${params.toString()}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.fetchTimeoutMs);
    let json: unknown;
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new ProviderFetchError(`ekispert API エラー (HTTP ${res.status})`);
      json = await res.json();
    } catch (e) {
      if (e instanceof ProviderFetchError) throw e;
      throw new ProviderFetchError(`ekispert への接続に失敗しました: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    return mapEkispertDepartures(json);
  }

  async fetchAlerts(_req: AlertRequest): Promise<AlertExtract[]> {
    throw new ProviderUnavailableError(
      'ekispert プロバイダは運行情報の自動更新に未対応です',
      'crawl-llm (URL 指定) を使うか、各社運行情報 API を別途配線してください。',
    );
  }
}
