// @implements SPEC-ACCESS-UI
import { useState } from 'react';
import type { AccessMarks } from '../../types.js';

type MarkKey = 'taxi_first_fare' | 'bus_stop_near' | 'shuttle_bus';

function km(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`;
}

/** 根拠の 1 文 (チップを押したときに出す)。 */
export function accessMarkReason(marks: AccessMarks, key: MarkKey): string | null {
  if (key === 'taxi_first_fare' && marks.taxi_first_fare) {
    const t = marks.taxi_first_fare;
    return `${t.origin_kind === 'base' ? '拠点' : ''}${t.origin_name}から道のり約 ${km(t.distance_m)} (初乗り ${km(t.threshold_m)} 以内)`;
  }
  if (key === 'bus_stop_near' && marks.bus_stop_near) {
    const b = marks.bus_stop_near;
    return `${b.stop_name} まで ${b.distance_m}m (${b.source === 'gtfs' ? '取り込み済み GTFS' : 'Google Places'})`;
  }
  if (key === 'shuttle_bus' && marks.shuttle_bus) {
    const s = marks.shuttle_bus;
    const from = { crawl: '施設サイト', summary: '場所の要約', notes: 'メモ', facility: '設備候補' }[s.source];
    return `${from}: 「${s.evidence}」`;
  }
  return null;
}

/**
 * 🚕 初乗り圏 / 🚏 バス停 ○m / 🚌 シャトルあり のチップ。押すと根拠を出す。
 * 印の無いものは出さない (「無い」とは言わない)。調べきれなかった印は ? で示す。
 */
export function AccessMarkChips({ marks, compact = false }: { marks: AccessMarks | undefined; compact?: boolean }) {
  const [open, setOpen] = useState<MarkKey | null>(null);
  if (!marks) return null;
  const chips: Array<{ key: MarkKey; label: string }> = [];
  if (marks.taxi_first_fare) chips.push({ key: 'taxi_first_fare', label: '🚕 初乗り圏' });
  if (marks.bus_stop_near) chips.push({ key: 'bus_stop_near', label: `🚏 バス停 ${marks.bus_stop_near.distance_m}m` });
  if (marks.shuttle_bus) chips.push({ key: 'shuttle_bus', label: '🚌 シャトルあり' });
  const unchecked = Object.values(marks.unchecked ?? {});
  if (chips.length === 0 && unchecked.length === 0) return null;

  const reason = open ? accessMarkReason(marks, open) : null;
  return (
    <span className="access-marks" onClick={(e) => e.stopPropagation()}>
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          className={`chip access-mark${open === c.key ? ' active' : ''}`}
          title={accessMarkReason(marks, c.key) ?? undefined}
          onClick={(e) => { e.preventDefault(); setOpen((cur) => (cur === c.key ? null : c.key)); }}
        >
          {compact ? c.label.split(' ')[0] : c.label}
        </button>
      ))}
      {unchecked.length > 0 && (
        <span className="chip access-mark unchecked" title={unchecked.join(' / ')}>? 未確認</span>
      )}
      {reason && <span className="access-mark-reason muted">{reason}</span>}
    </span>
  );
}
