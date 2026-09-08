import type { PlanDay, PlanItem, RouteMode } from '../../types.js';

const MODE_ICON: Record<RouteMode, string> = {
  driving: '🚗', walking: '🚶', transit: '🚃', bicycling: '🚲',
};

/** 所要の出所ラベル。概算を実測のように見せない。 */
const DURATION_SOURCE_LABEL: Record<'routes' | 'estimate' | 'gtfs', string> = {
  routes: '実所要',
  estimate: '概算',
  gtfs: '時刻表',
};

function fmtDuration(sec: number | null): string {
  if (sec == null) return '—';
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} 分` : `${Math.floor(m / 60)} 時間 ${m % 60} 分`;
}

function ItemRow({ item }: { item: PlanItem }) {
  if (item.kind === 'move') {
    return (
      <li className="muted">
        <span>{item.planned_time}</span>{' '}
        <span>{item.mode ? MODE_ICON[item.mode] : '→'}</span>{' '}
        <span>{item.label}</span>{' '}
        <span>{fmtDuration(item.duration_sec)}</span>{' '}
        <span className="chip">{DURATION_SOURCE_LABEL[item.duration_source ?? 'estimate']}</span>
        {item.transit && (
          <div style={{ paddingLeft: 16 }}>
            {item.transit.summary} — {item.transit.departure_time} 発 → {item.transit.arrival_time} 着
            {item.transit.transfer_count > 0 && ` / 乗換 ${item.transit.transfer_count} 回`}
            {item.transit.walk_from_m > 0 && ` / 徒歩 ${item.transit.walk_from_m}m + ${item.transit.walk_to_m}m`}
          </div>
        )}
      </li>
    );
  }
  return (
    <li>
      <strong>{item.planned_time}</strong> {item.label}
      {item.note && <span className="muted"> — {item.note}</span>}
    </li>
  );
}

/** 提案された 1 日。まだ DB には入っていない。 */
export function PlanDayPreview({ day }: { day: PlanDay }) {
  const visits = day.items.filter((i) => i.kind === 'visit').length;
  return (
    <article className="card">
      <div className="spread">
        <h4 style={{ margin: 0 }}>{day.date ?? `${day.day_index + 1} 日目`} — {day.title}</h4>
        <span className="chip">{visits} 件</span>
      </div>
      {day.note && <p className="muted" style={{ marginTop: 4 }}>{day.note}</p>}
      <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
        {day.items.map((item, index) => <ItemRow key={`${day.day_index}-${index}`} item={item} />)}
      </ul>
      <p className="muted" style={{ marginTop: 6 }}>
        移動 {fmtDuration(day.travel_sec)} / 滞在 {fmtDuration(day.stay_sec)}
      </p>
    </article>
  );
}
