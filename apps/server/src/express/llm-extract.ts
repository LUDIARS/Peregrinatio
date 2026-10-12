// URL (HTML / PDF) の時刻表を claude CLI で取り込みデータの形に抽出する。
// 既存の crawl-llm provider と同じ経路 (PoliteFetcher → htmlToText → complete) を使い、
// PDF は一時ファイルに落として Read ツールで読ませる (vision と同じ方式)。
// 取得失敗は ProviderFetchError (502)、URL 不足は ProviderInputError (400)。抽出結果の検証は呼び側。
// @implements SPEC-EXPRESS-IMPORT

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PoliteFetcher, htmlToText } from '@peregrinatio/crawl';
import { complete, extractJsonBlock, runClaudeCli } from '@peregrinatio/llm';
import type { Config } from '../config.js';
import { ProviderFetchError, ProviderInputError } from '../transit/provider.js';
import type { ExpressDirection } from './types.js';

const PASTE_HINT = '表の貼り付け (TSV/CSV) なら確実に取り込めます。';
const MAX_PDF_BYTES = 20 * 1024 * 1024;

const EXTRACT_FORMAT = [
  '出力は JSON オブジェクト 1 個のみ。前置き・説明は禁止。スキーマ:',
  '{ "stations": ["東京", "上野", ...],',
  '  "trains": [ { "train_name": "なすの 401号", "direction": "down" | "up", "service_note": "daily" | "weekday" | "holiday" | "自由文",',
  '               "stops": [ { "station": "東京", "arrive_time": "", "depart_time": "06:20" }, ... ] } ],',
  '  "valid_from": "YYYY-MM-DD (ダイヤ改正日。分からなければ空)" }',
  'ルール:',
  '- stations は下り方向 (起点 → 終点) の順に、表に出てくる停車駅をすべて並べる。',
  '- 各列車の stops は進行順。通過駅・非経由駅は含めない。時刻は "HH:MM" (日付をまたいだら 24:xx)。',
  '- 読み取れない列車は含めない。推測で時刻を埋めない。',
].join('\n');

export interface ExtractRequest {
  url: string;
  line_name: string;
  /** 片方向だけの表なら指定 (LLM へのヒント)。 */
  direction: ExpressDirection | null;
}

/** LLM の出力 (駅名で停車駅を表す形) を、保存リクエストと同じ形 (station_seq) へ寄せる。検証はしない。 */
export function llmOutputToDraft(raw: string): { stations: string[]; trains: unknown[]; valid_from: string | null } {
  const json = JSON.parse(extractJsonBlock(raw)) as Record<string, unknown>;
  const stations = Array.isArray(json.stations)
    ? json.stations.filter((s): s is string => typeof s === 'string').map((s) => s.normalize('NFKC').trim())
    : [];
  const seqOf = new Map(stations.map((name, seq) => [name, seq] as const));
  const trains = (Array.isArray(json.trains) ? json.trains : []).map((t) => {
    const r = (typeof t === 'object' && t !== null ? t : {}) as Record<string, unknown>;
    const stops = (Array.isArray(r.stops) ? r.stops : []).map((s) => {
      const o = (typeof s === 'object' && s !== null ? s : {}) as Record<string, unknown>;
      const name = typeof o.station === 'string' ? o.station.normalize('NFKC').trim() : '';
      // 駅一覧に無い駅名は -1 にして検証で列車ごと落とす (黙って近い駅に寄せない)。
      return { station_seq: seqOf.get(name) ?? -1, arrive_time: o.arrive_time ?? null, depart_time: o.depart_time ?? null };
    });
    return { ...r, stops };
  });
  const validFrom = typeof json.valid_from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(json.valid_from) ? json.valid_from : null;
  return { stations, trains, valid_from: validFrom };
}

function isPdf(url: string, contentType: string | null): boolean {
  return (contentType ?? '').toLowerCase().includes('application/pdf') || /\.pdf(?:$|[?#])/i.test(url);
}

function prompt(req: ExtractRequest): string {
  const dir = req.direction ? `表の方向: ${req.direction === 'down' ? '下り' : '上り'}。` : '';
  return `路線「${req.line_name}」の時刻表から列車と停車時刻を抽出してください。${dir}\n${EXTRACT_FORMAT}`;
}

async function extractFromPdf(url: string, req: ExtractRequest, config: Config): Promise<string> {
  const res = await fetch(url, {
    headers: { 'user-agent': config.crawl.userAgent, accept: 'application/pdf,*/*' },
    signal: AbortSignal.timeout(config.crawl.fetchTimeoutMs * 2),
  }).catch((e: unknown) => {
    throw new ProviderFetchError(`PDF を取得できませんでした (${e instanceof Error ? e.message : 'fetch error'})。${PASTE_HINT}`);
  });
  if (!res.ok) throw new ProviderFetchError(`PDF を取得できませんでした (HTTP ${res.status})。${PASTE_HINT}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_PDF_BYTES) throw new ProviderFetchError(`PDF が大きすぎます (${Math.round(bytes.length / 1e6)}MB)。${PASTE_HINT}`);

  const dir = await mkdtemp(join(tmpdir(), 'peregrinatio-express-'));
  try {
    const path = join(dir, 'timetable.pdf');
    await writeFile(path, bytes);
    return await runClaudeCli(
      ['次の PDF を Read ツールで開いて読んでください。', `PDF の絶対パス: ${path}`, '', prompt(req)].join('\n'),
      { model: config.llm.summaryModel, allowedTools: ['Read'], addDirs: [dir], timeoutMs: 300_000 },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function extractFromHtml(url: string, req: ExtractRequest, config: Config): Promise<string> {
  const fetcher = new PoliteFetcher({
    userAgent: config.crawl.userAgent,
    fetchTimeoutMs: config.crawl.fetchTimeoutMs,
    minIntervalMs: config.crawl.minIntervalMs,
    respectRobots: config.crawl.respectRobots,
  });
  const res = await fetcher.fetch(url);
  if (!res.ok) throw new ProviderFetchError(`ページを取得できませんでした (${res.reason}: ${res.message})。${PASTE_HINT}`);
  return complete({
    system: 'あなたは鉄道の時刻表ページから列車ごとの停車時刻を抽出するアシスタントです。',
    user: `${prompt(req)}\n--- 本文 ---\n${htmlToText(res.html)}`,
    model: config.llm.summaryModel,
  });
}

/** URL の時刻表を抽出し、LLM の生出力を返す。HTML か PDF かは拡張子と Content-Type で決める。 */
export async function extractTimetableFromUrl(req: ExtractRequest, config: Config): Promise<string> {
  const url = req.url.trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new ProviderInputError('時刻表ページまたは PDF の URL (http/https) を指定してください', PASTE_HINT);
  }
  let contentType: string | null = null;
  if (!/\.pdf(?:$|[?#])/i.test(url)) {
    // 拡張子で決まらないときだけ HEAD で種類を確かめる。HEAD 非対応のサーバは HTML として扱う。
    contentType = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(config.crawl.fetchTimeoutMs) })
      .then((r) => r.headers.get('content-type'))
      .catch(() => null);
  }
  return isPdf(url, contentType) ? extractFromPdf(url, req, config) : extractFromHtml(url, req, config);
}
