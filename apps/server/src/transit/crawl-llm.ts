// crawl-llm プロバイダ: 時刻表/運行情報ページの URL を PoliteFetcher で取得 →
// claude CLI (LLM) で便/運行情報を JSON 抽出する。契約・API キー不要 (既定プロバイダ)。
// 拠点ホテル IN/OUT (routes/hotel.ts) と同じ crawl→LLM 経路を踏襲。

import { PoliteFetcher, htmlToText } from '@peregrinatio/crawl';
import { complete } from '@peregrinatio/llm';
import type { Config } from '../config.js';
import { parseAlerts, parseDepartures } from './parse.js';
import {
  type AlertExtract,
  type AlertRequest,
  type DepartureExtract,
  type DepartureRequest,
  type TransitProvider,
  ProviderFetchError,
  ProviderInputError,
} from './provider.js';

const DEPARTURE_SYSTEM =
  'あなたは鉄道/バスの時刻表ページから発車便を抽出するアシスタントです。出力は JSON オブジェクト 1 個のみ。';
const ALERT_SYSTEM =
  'あなたは鉄道/バスの運行情報ページから遅延・運休などの情報を抽出するアシスタントです。出力は JSON オブジェクト 1 個のみ。';

export class CrawlLlmProvider implements TransitProvider {
  readonly kind = 'crawl-llm' as const;
  readonly supportsDepartures = true;
  readonly supportsAlerts = true;

  constructor(private readonly config: Config) {}

  private async crawlText(url: string): Promise<string> {
    const fetcher = new PoliteFetcher({
      userAgent: this.config.crawl.userAgent,
      fetchTimeoutMs: this.config.crawl.fetchTimeoutMs,
      minIntervalMs: this.config.crawl.minIntervalMs,
      respectRobots: this.config.crawl.respectRobots,
    });
    const res = await fetcher.fetch(url);
    if (!res.ok) throw new ProviderFetchError(`取得に失敗しました (${res.reason}): ${res.message}`);
    return htmlToText(res.html);
  }

  async fetchDepartures(req: DepartureRequest): Promise<DepartureExtract[]> {
    const url = (req.url ?? '').trim();
    if (!url) {
      throw new ProviderInputError(
        '時刻表ページの URL を指定してください',
        'crawl-llm は指定 URL をクロールして便を抽出します (各社/乗換案内の時刻表ページ等)。',
      );
    }
    const text = await this.crawlText(url);
    const section = [req.line_name, req.from_station, req.to_station].filter(Boolean).join(' / ');
    const raw = await complete({
      system: DEPARTURE_SYSTEM,
      user: [
        `次のページ本文から発車便の一覧を抽出してください。${section ? `対象区間: ${section}。` : ''}`,
        '各便: depart_time(発, "HH:MM"), arrive_time(着, "HH:MM" 不明なら空), train_name(列車/便名),',
        'platform(のりば), fare_text(運賃 文字列), note(備考)。時刻が読めない行は含めないでください。',
        '出力フォーマット: { "departures": [ { "depart_time": "08:00", "arrive_time": "10:30", "train_name": "かがやき501号", "platform": "", "fare_text": "", "note": "" } ] }',
        '--- 本文 ---',
        text,
      ].join('\n'),
      model: this.config.llm.summaryModel,
    });
    return parseDepartures(raw);
  }

  async fetchAlerts(req: AlertRequest): Promise<AlertExtract[]> {
    const url = (req.url ?? '').trim();
    if (!url) {
      throw new ProviderInputError(
        '運行情報ページの URL を指定してください',
        'crawl-llm は指定 URL をクロールして運行情報を抽出します (各社運行情報ページ等)。',
      );
    }
    const text = await this.crawlText(url);
    const raw = await complete({
      system: ALERT_SYSTEM,
      user: [
        `次のページ本文から運行情報 (遅延/運休/見合わせ等) を抽出してください。${req.line_name ? `対象路線: ${req.line_name}。` : ''}`,
        '各件: line_name(路線/系統), severity("normal"|"info"|"warning"|"suspended"),',
        'title(見出し), body(詳細), source_url(出典 URL 不明なら空)。平常運転で特記が無ければ空配列。',
        '出力フォーマット: { "alerts": [ { "line_name": "北陸新幹線", "severity": "warning", "title": "遅延", "body": "...", "source_url": "" } ] }',
        '--- 本文 ---',
        text,
      ].join('\n'),
      model: this.config.llm.summaryModel,
    });
    return parseAlerts(raw);
  }
}
