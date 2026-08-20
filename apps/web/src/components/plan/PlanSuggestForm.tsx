import type { PlanPace, PlanSuggestInput, RouteMode } from '../../types.js';

const MODES: Array<{ value: RouteMode; label: string }> = [
  { value: 'transit', label: '公共交通' },
  { value: 'driving', label: '車' },
  { value: 'walking', label: '徒歩' },
  { value: 'bicycling', label: '自転車' },
];

const PACES: Array<{ value: PlanPace; label: string; hint: string }> = [
  { value: 'relaxed', label: 'ゆったり', hint: '1 日 3 件まで・滞在長め' },
  { value: 'standard', label: 'ふつう', hint: '1 日 4 件まで' },
  { value: 'packed', label: '詰め込み', hint: '1 日 6 件まで・滞在短め' },
];

/** プラン提案の条件入力。交通手段が日割りの軸になる。 */
export function PlanSuggestForm({
  value, onChange, onSubmit, busy,
}: {
  value: PlanSuggestInput & { use_llm: boolean };
  onChange: (next: PlanSuggestInput & { use_llm: boolean }) => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  const set = <K extends keyof (PlanSuggestInput & { use_llm: boolean })>(
    key: K,
    v: (PlanSuggestInput & { use_llm: boolean })[K],
  ) => onChange({ ...value, [key]: v });

  return (
    <form
      className="card foundation-form"
      onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
    >
      <label>
        主な交通手段
        <select value={value.primary_mode} onChange={(e) => set('primary_mode', e.target.value as RouteMode)}>
          {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </label>

      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <label style={{ flex: 1, minWidth: 120 }}>
          活動開始
          <input type="time" value={value.day_start} onChange={(e) => set('day_start', e.target.value)} />
        </label>
        <label style={{ flex: 1, minWidth: 120 }}>
          活動終了
          <input type="time" value={value.day_end} onChange={(e) => set('day_end', e.target.value)} />
        </label>
      </div>

      <label>
        ペース
        <select value={value.pace} onChange={(e) => set('pace', e.target.value as PlanPace)}>
          {PACES.map((p) => <option key={p.value} value={p.value}>{p.label} ({p.hint})</option>)}
        </select>
      </label>

      <label className="prep-check">
        <input
          type="checkbox"
          checked={value.use_routes_api}
          onChange={(e) => set('use_routes_api', e.target.checked)}
        />
        <span>実際の所要時間を調べる (Google Routes API を使う)</span>
      </label>
      <label className="prep-check">
        <input type="checkbox" checked={value.use_llm} onChange={(e) => set('use_llm', e.target.checked)} />
        <span>各日の見出しを付ける</span>
      </label>

      <button type="submit" disabled={busy}>{busy ? '考え中...' : '案を作る'}</button>
    </form>
  );
}
