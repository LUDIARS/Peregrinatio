// 取り込みプレビューを作る (保存しない)。貼り付け / URL のどちらも、最後は同じ検証と駅座標付けを通す。
// @implements SPEC-EXPRESS-IMPORT

import type { Config } from '../config.js';
import { ProviderFetchError, ProviderInputError } from '../transit/provider.js';
import { validateImportPayload, type ImportValidation } from './import-validate.js';
import { extractTimetableFromUrl, llmOutputToDraft } from './llm-extract.js';
import { buildPasteImport, type PastedTable } from './paste-import.js';
import { geocodeStations, type StationGeocoder } from './station-geocode.js';
import { EXPRESS_DIRECTIONS, type ExpressDirection, type ExpressImportLine } from './types.js';

export interface PreviewRequest {
  line: Partial<ExpressImportLine>;
  mode: 'paste' | 'url';
  tables?: PastedTable[];
  url?: string;
  direction?: ExpressDirection | null;
}

/** 入力の形だけを確かめる (中身の検証は validateImportPayload)。 */
export function parsePreviewRequest(raw: unknown): { ok: true; req: PreviewRequest } | { ok: false; error: string } {
  const b = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const line = (typeof b.line === 'object' && b.line !== null ? b.line : {}) as Partial<ExpressImportLine>;
  const direction = (EXPRESS_DIRECTIONS as readonly unknown[]).includes(b.direction) ? b.direction as ExpressDirection : null;
  if (b.mode === 'url') {
    if (typeof b.url !== 'string' || !b.url.trim()) return { ok: false, error: 'url を指定してください' };
    return { ok: true, req: { line, mode: 'url', url: b.url.trim(), direction } };
  }
  if (b.mode !== 'paste') return { ok: false, error: 'mode は paste / url のどちらかです' };
  const tables = (Array.isArray(b.tables) ? b.tables : [])
    .map((t) => (typeof t === 'object' && t !== null ? t : {}) as Record<string, unknown>)
    .filter((t) => typeof t.text === 'string' && t.text.trim() !== '')
    .map((t) => ({
      direction: (EXPRESS_DIRECTIONS as readonly unknown[]).includes(t.direction) ? t.direction as ExpressDirection : 'down',
      text: t.text as string,
    }));
  if (tables.length === 0) return { ok: false, error: '時刻表の表を貼り付けてください' };
  return { ok: true, req: { line, mode: 'paste', tables } };
}

function lineOf(partial: Partial<ExpressImportLine>, validFrom: string | null): Record<string, unknown> {
  return { ...partial, valid_from: partial.valid_from || validFrom };
}

async function withCoords(v: ImportValidation, geocoder?: StationGeocoder): Promise<ImportValidation> {
  if (!v.ok) return v;
  const geo = await geocodeStations(v.payload.stations, geocoder);
  return { ok: true, payload: { ...v.payload, stations: geo.stations, warnings: [...v.payload.warnings, ...geo.warnings] } };
}

/**
 * プレビューを作る。URL の取得・抽出の失敗は ProviderFetchError / ProviderInputError を投げる (ルートで 502 / 400)。
 * LLM の出力が JSON として読めないときも取得失敗として扱い、貼り付けへ誘導する。
 */
export async function buildPreview(req: PreviewRequest, config: Config, geocoder?: StationGeocoder): Promise<ImportValidation> {
  if (req.mode === 'paste') {
    const draft = buildPasteImport(lineOf(req.line, null) as unknown as ExpressImportLine, req.tables ?? []);
    return withCoords(validateImportPayload(draft), geocoder);
  }

  const lineName = typeof req.line.name === 'string' ? req.line.name.trim() : '';
  if (!lineName) throw new ProviderInputError('路線名を入力してください');
  const raw = await extractTimetableFromUrl({ url: req.url ?? '', line_name: lineName, direction: req.direction ?? null }, config);
  let draft: ReturnType<typeof llmOutputToDraft>;
  try {
    draft = llmOutputToDraft(raw);
  } catch {
    throw new ProviderFetchError('時刻表を読み取れませんでした (抽出結果が JSON になっていません)。表の貼り付けで取り込んでください。');
  }
  return withCoords(validateImportPayload({
    line: lineOf({ ...req.line, source_url: req.line.source_url || req.url }, draft.valid_from),
    stations: draft.stations.map((name) => ({ name })),
    trains: draft.trains,
    warnings: ['URL からの抽出結果です。時刻と駅順をプレビューで確認してから保存してください。'],
  }), geocoder);
}
