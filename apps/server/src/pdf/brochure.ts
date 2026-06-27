// 旅のしおり PDF を「旅行ツアーのパンフレット (行程表)」風にレンダリングする HTML/CSS ビルダー。
// ルート (routes/pdf.ts) から切り出して純関数化 (SRP)。DB/Puppeteer には依存しない。
//
// 構成: 表紙 (ヒーロー写真 + タイトル + 日程サマリ) → 行程概要 → 日ごとのタイムライン
// (スポットカード + 移動コネクタ)。日本語フォントは body の font-family で OS フォントに委ねる。

import type { Trip, TripDay, Place, PlaceImage, ItineraryItem, RouteLeg } from '../types.js';

export interface BrochureInput {
  trip: Trip;
  days: TripDay[];
  itemsByDay: Map<string, ItineraryItem[]>;
  legsByDay: Map<string, RouteLeg[]>;
  placeMap: Map<string, Place>;
  compositeByPlace: Map<string, PlaceImage>;
  /** /uploads/... の相対パスを絶対化するためのベース (例: http://127.0.0.1:8090)。 */
  assetBase: string;
}

const MODE_LABEL: Record<string, string> = {
  walking: '徒歩', driving: '車', transit: '公共交通', bicycling: '自転車',
};
const MODE_ICON: Record<string, string> = {
  walking: '🚶', driving: '🚗', transit: '🚆', bicycling: '🚲',
};
const KIND_ICON: Record<string, string> = { visit: '📍', move: '🚃', note: '📝' };

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function resolveImg(path: string | null | undefined, assetBase: string): string {
  if (!path) return '';
  if (/^(https?:|data:)/.test(path)) return path; // 外部 URL / data URI はそのまま
  return `${assetBase}${path.startsWith('/') ? path : `/${path}`}`;
}

function fmtPeriod(trip: Trip): string {
  if (trip.start_date && trip.end_date) return `${trip.start_date} 〜 ${trip.end_date}`;
  return trip.start_date ?? trip.end_date ?? '日程未定';
}

/** start/end 日付から旅の会期日数 (両端含む) を返す。日付欠落/不正なら null。 */
function tripSpanDays(trip: Trip): number | null {
  if (!trip.start_date || !trip.end_date) return null;
  const s = Date.parse(trip.start_date);
  const e = Date.parse(trip.end_date);
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return null;
  return Math.round((e - s) / 86_400_000) + 1;
}

function fmtDuration(sec: number | null): string {
  if (sec == null) return '';
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}分`;
  const h = Math.floor(m / 60);
  return m % 60 === 0 ? `${h}時間` : `${h}時間${m % 60}分`;
}

function fmtDistance(m: number | null): string {
  if (m == null) return '';
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`;
}

/** スポット 1 件のカード (写真 + 名称 + カテゴリ + 住所 + 概要)。 */
function spotCard(p: Place, time: string | null, assetBase: string, note: string | null): string {
  const img = resolveImg(p.image_url, assetBase);
  const photo = img ? `<div class="spot-photo"><img src="${esc(img)}" alt=""></div>` : '';
  const timeBubble = time
    ? `<div class="time-bubble">${esc(time)}</div>`
    : `<div class="time-bubble icon">📍</div>`;
  return `
    <div class="tl-node">
      <div class="tl-rail">${timeBubble}</div>
      <div class="spot-card">
        ${photo}
        <div class="spot-body">
          <div class="spot-name">${esc(p.name)}</div>
          <div class="spot-meta">
            ${p.category ? `<span class="tag">${esc(p.category)}</span>` : ''}
            ${p.address ? `<span class="spot-addr">${esc(p.address)}</span>` : ''}
          </div>
          ${p.summary ? `<div class="spot-summary">${esc(p.summary)}</div>` : ''}
          ${note ? `<div class="spot-note">📝 ${esc(note)}</div>` : ''}
        </div>
      </div>
    </div>`;
}

/** メモのみ (場所なし) の予定。 */
function noteNode(it: ItineraryItem): string {
  const timeBubble = it.planned_time
    ? `<div class="time-bubble">${esc(it.planned_time)}</div>`
    : `<div class="time-bubble icon">📝</div>`;
  return `
    <div class="tl-node">
      <div class="tl-rail">${timeBubble}</div>
      <div class="spot-card note-card">
        <div class="spot-body"><div class="spot-note-only">${esc(it.note ?? '')}</div></div>
      </div>
    </div>`;
}

/** スポット間の移動コネクタ (徒歩 12分 / 0.8km など)。 */
function moveConnector(leg: RouteLeg): string {
  const meta = [fmtDuration(leg.duration_sec), fmtDistance(leg.distance_m), leg.fare_text ?? '']
    .filter(Boolean)
    .join(' ・ ');
  const icon = MODE_ICON[leg.mode] ?? '➡️';
  const label = MODE_LABEL[leg.mode] ?? leg.mode;
  return `
    <div class="tl-move">
      <div class="tl-rail"><div class="move-dot">${icon}</div></div>
      <div class="move-text">${esc(label)}${meta ? ` <span class="move-meta">${esc(meta)}</span>` : ''}</div>
    </div>`;
}

function dayHero(trip: Trip, input: BrochureInput): string {
  // 表紙のヒーロー写真: 旅のカバー → 最初の拠点の写真 → 最初に写真がある場所。
  const { placeMap, assetBase } = input;
  let raw: string | null = trip.cover_image_path ?? null;
  if (!raw) {
    const withImg = [...placeMap.values()].find((p) => p.image_url);
    raw = withImg?.image_url ?? null;
  }
  const url = resolveImg(raw, assetBase);
  return url ? `<div class="cover-hero" style="background-image:url('${esc(url)}')"></div>` : '';
}

export function buildBrochureHtml(input: BrochureInput): string {
  const { trip, days, itemsByDay, legsByDay, placeMap, assetBase } = input;

  // 「○泊○日」は旅の会期 (start/end 日付) から。日付が無ければ登録日数で代替。
  const span = tripSpanDays(trip);
  const totalDays = span ?? days.length;
  const nights = Math.max(0, totalDays - 1);
  const spotCount = new Set(
    [...itemsByDay.values()].flat().map((it) => it.place_id).filter(Boolean),
  ).size;

  // 行程概要テーブル。
  const overviewRows = days
    .map((d) => {
      const items = itemsByDay.get(d.id) ?? [];
      const spots = items.filter((it) => it.place_id).length;
      const title = [d.date, d.title].filter(Boolean).join(' ') || '—';
      return `<tr><td class="ov-day">Day ${d.day_index + 1}</td><td>${esc(title)}</td><td class="ov-spots">${spots} スポット</td></tr>`;
    })
    .join('');

  const daySections = days
    .map((d) => {
      const items = itemsByDay.get(d.id) ?? [];
      // 連続するスポット間の移動は leg を突合して間に差し込む。
      const legs = legsByDay.get(d.id) ?? [];
      const legByPair = new Map<string, RouteLeg>();
      for (const l of legs) {
        if (l.from_place_id && l.to_place_id) legByPair.set(`${l.from_place_id}|${l.to_place_id}`, l);
      }
      const usedLegs = new Set<string>();

      const nodes: string[] = [];
      let prevPlaceId: string | null = null;
      for (const it of items) {
        const place = it.place_id ? placeMap.get(it.place_id) : undefined;
        if (place && prevPlaceId) {
          const key = `${prevPlaceId}|${place.id}`;
          const leg = legByPair.get(key);
          if (leg) { nodes.push(moveConnector(leg)); usedLegs.add(leg.id); }
        }
        if (place) {
          nodes.push(spotCard(place, it.planned_time, assetBase, it.note));
          prevPlaceId = place.id;
        } else {
          nodes.push(noteNode(it));
        }
      }

      // 突合できなかった移動はまとめて末尾に。
      const leftover = legs.filter((l) => !usedLegs.has(l.id));
      const leftoverHtml = leftover.length
        ? `<div class="legs-extra"><div class="legs-extra-title">そのほかの移動</div>${leftover
            .map((l) => {
              const from = l.from_place_id ? placeMap.get(l.from_place_id)?.name ?? '' : l.from_label ?? '';
              const to = l.to_place_id ? placeMap.get(l.to_place_id)?.name ?? '' : l.to_label ?? '';
              const meta = [fmtDuration(l.duration_sec), fmtDistance(l.distance_m), l.fare_text ?? ''].filter(Boolean).join(' ・ ');
              return `<div class="leg-extra">${MODE_ICON[l.mode] ?? '➡️'} ${esc(from)} → ${esc(to)} <span class="move-meta">${esc(MODE_LABEL[l.mode] ?? l.mode)}${meta ? ` ${meta}` : ''}</span></div>`;
            })
            .join('')}</div>`
        : '';

      const heading = [d.date, d.title].filter(Boolean).join('　');
      return `
        <section class="day">
          <div class="day-band">
            <div class="day-badge"><span class="day-badge-label">DAY</span><span class="day-badge-num">${d.day_index + 1}</span></div>
            <div class="day-head-text">
              <div class="day-title">${esc(d.title || `${d.day_index + 1} 日目`)}</div>
              ${d.date ? `<div class="day-date">${esc(d.date)}</div>` : ''}
            </div>
          </div>
          ${d.notes ? `<div class="day-notes">${esc(d.notes)}</div>` : ''}
          <div class="timeline">
            ${nodes.join('') || '<div class="empty">この日の予定はまだありません。</div>'}
          </div>
          ${leftoverHtml}
        </section>`;
    })
    .join('');

  const summaryChips = [
    totalDays > 0 ? `${nights}泊${totalDays}日` : '日程未定',
    `全 ${days.length} 日程`,
    `${spotCount} スポット`,
  ]
    .map((t) => `<span class="chip">${esc(t)}</span>`)
    .join('');

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<style>
  :root {
    --accent: #e8590c;      /* 旅のアクセント (オレンジ) */
    --accent-2: #0e7c86;    /* サブ (ティール) */
    --ink: #222;
    --muted: #6b7280;
    --line: #e5e7eb;
    --paper: #fbfaf7;
  }
  * { box-sizing: border-box; }
  body { font-family: "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif; color: var(--ink); margin: 0; background: var(--paper); }

  /* ---- 表紙 ---- */
  .cover { position: relative; height: 100vh; page-break-after: always; overflow: hidden; background: linear-gradient(135deg, var(--accent), var(--accent-2)); }
  .cover-hero { position: absolute; inset: 0; background-size: cover; background-position: center; }
  .cover-hero::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,.15) 0%, rgba(0,0,0,.55) 70%, rgba(0,0,0,.72) 100%); }
  .cover-inner { position: absolute; left: 0; right: 0; bottom: 0; padding: 48px 56px; color: #fff; z-index: 2; }
  .eyebrow { font-size: 13px; letter-spacing: .32em; text-transform: uppercase; opacity: .92; margin-bottom: 14px; font-weight: 700; }
  .cover h1 { font-size: 42px; line-height: 1.18; margin: 0 0 14px; text-shadow: 0 2px 12px rgba(0,0,0,.4); }
  .cover .period { font-size: 18px; font-weight: 600; opacity: .96; }
  .cover .chips { margin-top: 20px; display: flex; gap: 10px; flex-wrap: wrap; }
  .cover .chip { background: rgba(255,255,255,.18); border: 1px solid rgba(255,255,255,.5); color: #fff; padding: 5px 14px; border-radius: 999px; font-size: 13px; font-weight: 600; backdrop-filter: blur(2px); }
  .cover .notes { margin-top: 20px; font-size: 13px; line-height: 1.7; opacity: .92; white-space: pre-wrap; max-width: 80%; }
  .cover-eyebrow-top { position: absolute; top: 40px; left: 56px; z-index: 2; color: #fff; font-size: 12px; letter-spacing: .3em; font-weight: 700; opacity: .9; }

  /* ---- 行程概要 ---- */
  .overview { padding: 40px 48px 8px; }
  .section-title { font-size: 20px; font-weight: 800; color: var(--accent); margin: 0 0 4px; }
  .section-rule { height: 3px; width: 56px; background: var(--accent); border-radius: 2px; margin-bottom: 18px; }
  table.overview-table { width: 100%; border-collapse: collapse; font-size: 14px; }
  table.overview-table td { padding: 12px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  .ov-day { font-weight: 800; color: var(--accent-2); white-space: nowrap; width: 80px; }
  .ov-spots { text-align: right; color: var(--muted); white-space: nowrap; font-size: 13px; }

  /* ---- 日セクション ---- */
  .day { padding: 28px 48px 8px; page-break-before: always; }
  .day-band { display: flex; align-items: center; gap: 16px; padding-bottom: 14px; border-bottom: 2px solid var(--accent); margin-bottom: 18px; }
  .day-badge { background: var(--accent); color: #fff; border-radius: 12px; width: 60px; height: 60px; display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 0 0 auto; }
  .day-badge-label { font-size: 10px; letter-spacing: .18em; font-weight: 700; opacity: .9; }
  .day-badge-num { font-size: 28px; font-weight: 800; line-height: 1; }
  .day-head-text { min-width: 0; }
  .day-title { font-size: 22px; font-weight: 800; }
  .day-date { font-size: 13px; color: var(--muted); margin-top: 2px; }
  .day-notes { font-size: 12.5px; color: var(--muted); background: #fff; border-left: 3px solid var(--accent-2); padding: 8px 12px; border-radius: 0 6px 6px 0; margin-bottom: 16px; white-space: pre-wrap; }

  /* ---- タイムライン ---- */
  .timeline { position: relative; }
  .tl-node, .tl-move { display: flex; gap: 16px; page-break-inside: avoid; }
  .tl-rail { flex: 0 0 56px; display: flex; justify-content: center; position: relative; }
  .tl-rail::before { content: ""; position: absolute; top: 0; bottom: 0; left: 50%; width: 2px; background: var(--line); transform: translateX(-50%); }
  .tl-node:first-child .tl-rail::before { top: 18px; }
  .time-bubble { position: relative; z-index: 1; background: var(--accent); color: #fff; font-size: 12px; font-weight: 700; min-width: 48px; height: 26px; padding: 0 8px; border-radius: 999px; display: flex; align-items: center; justify-content: center; margin-top: 8px; box-shadow: 0 0 0 4px var(--paper); }
  .time-bubble.icon { background: #fff; color: var(--accent); border: 2px solid var(--accent); min-width: 30px; }
  .move-dot { position: relative; z-index: 1; width: 26px; height: 26px; border-radius: 999px; background: #fff; border: 1px dashed var(--muted); display: flex; align-items: center; justify-content: center; font-size: 13px; margin: 4px 0; box-shadow: 0 0 0 4px var(--paper); }

  .spot-card { flex: 1; display: flex; gap: 14px; background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; margin: 6px 0 14px; box-shadow: 0 1px 3px rgba(0,0,0,.04); }
  .note-card { background: #fffdf6; }
  .spot-photo { flex: 0 0 124px; }
  .spot-photo img { width: 124px; height: 92px; object-fit: cover; border-radius: 8px; display: block; }
  .spot-body { min-width: 0; flex: 1; }
  .spot-name { font-size: 16px; font-weight: 800; line-height: 1.3; }
  .spot-meta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 4px; }
  .tag { background: var(--accent-2); color: #fff; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
  .spot-addr { font-size: 11.5px; color: var(--muted); }
  .spot-summary { font-size: 12.5px; line-height: 1.65; margin-top: 6px; color: #333; white-space: pre-wrap; }
  .spot-note { font-size: 12px; color: var(--accent); margin-top: 6px; }
  .spot-note-only { font-size: 13px; color: #444; white-space: pre-wrap; }

  .tl-move { align-items: center; }
  .move-text { font-size: 12.5px; color: var(--muted); font-weight: 600; }
  .move-meta { color: var(--accent-2); font-weight: 700; margin-left: 4px; }

  .legs-extra { margin: 6px 0 12px 72px; padding: 10px 12px; background: #fff; border: 1px dashed var(--line); border-radius: 8px; }
  .legs-extra-title { font-size: 11px; font-weight: 700; color: var(--muted); margin-bottom: 6px; }
  .leg-extra { font-size: 12px; color: #444; padding: 2px 0; }
  .empty { font-size: 13px; color: var(--muted); padding: 12px 0 0 16px; }
</style>
</head>
<body>
  <div class="cover">
    ${dayHero(trip, input)}
    <div class="cover-eyebrow-top">PEREGRINATIO ・ TRAVEL ITINERARY</div>
    <div class="cover-inner">
      <div class="eyebrow">旅のしおり</div>
      <h1>${esc(trip.title)}</h1>
      <div class="period">${esc(fmtPeriod(trip))}</div>
      <div class="chips">${summaryChips}</div>
      ${trip.notes ? `<div class="notes">${esc(trip.notes)}</div>` : ''}
    </div>
  </div>

  <div class="overview">
    <div class="section-title">行程概要</div>
    <div class="section-rule"></div>
    ${days.length ? `<table class="overview-table">${overviewRows}</table>` : '<div class="empty">日程がまだ登録されていません。</div>'}
  </div>

  ${daySections}
</body>
</html>`;
}
