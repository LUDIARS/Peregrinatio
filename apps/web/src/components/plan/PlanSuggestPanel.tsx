// @implements SPEC-EXPRESS-PLAN
// @implements SPEC-ACCESS-UI
import { useState } from 'react';
import { api } from '../../api.js';
import { PlanSuggestForm } from './PlanSuggestForm.js';
import { PlanDayPreview } from './PlanDayPreview.js';
import { switchExpressChoice } from './plan-express-switch.js';
import { AccessMarkChips } from '../place/AccessMarkChips.js';
import type { PlanSuggestInput, PlanSuggestResult } from '../../types.js';

type FormValue = PlanSuggestInput & { use_llm: boolean };

const INITIAL: FormValue = {
  primary_mode: 'transit',
  day_start: '09:00',
  day_end: '18:00',
  pace: 'standard',
  must_place_ids: [],
  exclude_place_ids: [],
  use_routes_api: false,
  max_station_hops: 3,
  reach_radius_m: null,
  use_llm: true,
};

/**
 * プランの自動決定パネル。
 * 「案を作る」は提案だけで旅は変わらない。「この案を採用」で初めて日程を上書きする。
 */
export function PlanSuggestPanel({ tripId, onAdopted }: { tripId: string; onAdopted: () => Promise<void> }) {
  const [form, setForm] = useState<FormValue>(INITIAL);
  const [result, setResult] = useState<PlanSuggestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [confirming, setConfirming] = useState(false);

  const run = async () => {
    setBusy(true); setError(''); setDone(''); setConfirming(false);
    try {
      setResult(await api.suggestPlan(tripId, form));
    } catch (e) {
      setError(e instanceof Error ? e.message : '案の作成に失敗しました');
    } finally { setBusy(false); }
  };

  const adopt = async () => {
    if (!result) return;
    setBusy(true); setError('');
    try {
      const res = await api.adoptPlan(tripId, result.days);
      setDone(`${res.items} 件の予定を反映しました (既存 ${res.replaced} 件を置き換え)。`);
      setResult(null);
      setConfirming(false);
      await onAdopted();
    } catch (e) {
      setError(e instanceof Error ? e.message : '採用に失敗しました');
    } finally { setBusy(false); }
  };

  return (
    <section className="card stack">
      <h3 style={{ margin: 0 }}>プランを自動で決める</h3>
      <p className="muted">
        交通手段を軸に、移動時間と滞在時間が 1 日に収まる範囲で日割りします。
        案を作った時点では旅の予定は変わりません。
      </p>

      <PlanSuggestForm value={form} onChange={setForm} onSubmit={() => void run()} busy={busy} />

      {error && <div className="error">{error}</div>}
      {done && <div className="card">{done}</div>}

      {result && (
        <>
          {result.hints.length > 0 && (
            <div className="card">
              {result.hints.map((h) => (
                <p key={h.key} className="muted" style={{ margin: '4px 0' }}>
                  <strong>{h.label}</strong> — {h.detail}
                </p>
              ))}
            </div>
          )}
          <div className="prep-meta">
            <span className="chip">
              {result.strategy === 'transit_timetable' ? '時刻表の実便で作成' : '距離からの概算で作成'}
            </span>
          </div>

          {result.new_places.length > 0 && (
            <div className="card">
              <h4 style={{ margin: '0 0 4px' }}>沿線で見つけた候補 (旅にはまだありません)</h4>
              {result.new_places.map((p) => (
                <div key={p.google_place_id} style={{ margin: '2px 0' }}>
                  <span className="muted">{p.name}{p.address ? ` — ${p.address}` : ''}（{p.found_by}）</span>{' '}
                  <AccessMarkChips marks={p.access_marks} />
                </div>
              ))}
            </div>
          )}

          {result.reach && (
            <div className="card">
              <strong>回る範囲</strong>
              <p className="muted" style={{ margin: '4px 0' }}>
                拠点から半径 約 {Math.round(result.reach.radius_m / 1000)}km
                {result.reach.source === 'default' && '（駅が見つからず既定値）'}
                {result.reach.source === 'manual' && '（手動指定）'}
              </p>
              {result.reach.stations.length > 0 && (
                <p className="muted" style={{ margin: 0 }}>
                  基準にした駅: {result.reach.stations
                    .map((s) => `${s.name} (${(s.distance_m / 1000).toFixed(1)}km)`).join(' / ')}
                </p>
              )}
            </div>
          )}
          {result.warnings.map((w) => <div key={w} className="muted">⚠ {w}</div>)}

          <div className="stack">
            {result.days.map((day) => (
              <PlanDayPreview
                key={day.day_index}
                day={day}
                express={result.express}
                onSwitchExpress={(direction, index) => setResult((r) => (r ? switchExpressChoice(r, direction, index) : r))}
              />
            ))}
            {result.express && (result.express.outbound.length > 1 || result.express.inbound.length > 1) && (
              <p className="muted" style={{ margin: 0 }}>
                往復の便を切り替えても日中の予定の時刻は動きません。拠点に着く時刻が大きく変わるときは案を作り直してください。
              </p>
            )}
          </div>

          {result.leftovers.length > 0 && (
            <div className="card">
              <h4 style={{ margin: '0 0 4px' }}>この案から外した場所</h4>
              {result.leftovers.map((l) => (
                <p key={l.place_id} className="muted" style={{ margin: '2px 0' }}>{l.name} — {l.reason}</p>
              ))}
            </div>
          )}

          {confirming ? (
            <div className="card">
              <p style={{ margin: '0 0 8px' }}>
                この案を採用すると、対象の日の予定と経路がすべて置き換わります。よろしいですか?
              </p>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" onClick={() => void adopt()} disabled={busy}>
                  {busy ? '反映中...' : '上書きして採用する'}
                </button>
                <button type="button" className="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                  やめる
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} disabled={busy || result.days.length === 0}>
              この案を採用する (既存の予定を上書き)
            </button>
          )}
        </>
      )}
    </section>
  );
}
