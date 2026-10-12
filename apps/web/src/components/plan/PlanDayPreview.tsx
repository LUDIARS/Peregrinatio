// @implements SPEC-EXPRESS-PLAN
import type { ReactNode } from 'react';
import type { PlanDay, PlanExpressSummary, PlanItem, RouteMode } from '../../types.js';
import { fmtDuration } from './plan-format.js';

const MODE_ICON: Record<RouteMode, string> = {
  driving: '🚗', walking: '🚶', transit: '🚃', bicycling: '🚲',
};

/** 所要の出所ラベル。概算を実測のように見せない。 */
const DURATION_SOURCE_LABEL: Record<NonNullable<PlanItem['duration_source']>, string> = {
  routes: '実所要',
  estimate: '概算',
  gtfs: '時刻表',
  express_timetable: '新幹線・特急',
};

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
        {!item.transit && item.note && <div style={{ paddingLeft: 16 }}>{item.note}</div>}
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

type ExpressDirection = 'outbound' | 'inbound';

/** 往復便の行の上に置く候補便の切り替え。 */
function ExpressSwitcher({
  direction, express, onSwitch,
}: {
  direction: ExpressDirection;
  express: PlanExpressSummary;
  onSwitch: (direction: ExpressDirection, index: number) => void;
}) {
  const choices = direction === 'outbound' ? express.outbound : express.inbound;
  const selected = direction === 'outbound' ? express.selected_outbound : express.selected_inbound;
  if (choices.length < 2 || selected == null) return null;
  return (
    <li className="plan-express-switch">
      <label className="muted">
        {direction === 'outbound' ? '往路の便: ' : '復路の便: '}
        <select value={selected} onChange={(e) => onSwitch(direction, Number(e.target.value))}>
          {choices.map((c, i) => (
            <option key={`${c.option.train_id}-${i}`} value={i}>
              {c.option.train_name} {c.option.depart_time} → {c.option.arrive_time}
              {direction === 'outbound' ? ` (拠点着 ${c.option.terminal.arrive_time})` : ''}
            </option>
          ))}
        </select>
      </label>
    </li>
  );
}

/** 提案された 1 日。まだ DB には入っていない。 */
export function PlanDayPreview({
  day, express, onSwitchExpress,
}: {
  day: PlanDay;
  express?: PlanExpressSummary | null;
  onSwitchExpress?: (direction: ExpressDirection, index: number) => void;
}) {
  const visits = day.items.filter((i) => i.kind === 'visit').length;
  const rows: ReactNode[] = [];
  const shown = new Set<ExpressDirection>();
  day.items.forEach((item, index) => {
    const dir = item.express_ref?.direction;
    if (dir && express && onSwitchExpress && !shown.has(dir)) {
      shown.add(dir);
      rows.push(<ExpressSwitcher key={`switch-${dir}`} direction={dir} express={express} onSwitch={onSwitchExpress} />);
    }
    rows.push(<ItemRow key={`${day.day_index}-${index}`} item={item} />);
  });
  return (
    <article className="card">
      <div className="spread">
        <h4 style={{ margin: 0 }}>{day.date ?? `${day.day_index + 1} 日目`} — {day.title}</h4>
        <span className="chip">{visits} 件</span>
      </div>
      {day.note && <p className="muted" style={{ marginTop: 4 }}>{day.note}</p>}
      <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>{rows}</ul>
      <p className="muted" style={{ marginTop: 6 }}>
        移動 {fmtDuration(day.travel_sec)} / 滞在 {fmtDuration(day.stay_sec)}
      </p>
    </article>
  );
}
