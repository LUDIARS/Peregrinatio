import { useState } from 'react';
import { api } from '../../api.js';
import { PlanSuggestForm } from './PlanSuggestForm.js';
import { PlanDayPreview } from './PlanDayPreview.js';
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
          {result.warnings.map((w) => <div key={w} className="muted">⚠ {w}</div>)}

          <div className="stack">
            {result.days.map((day) => <PlanDayPreview key={day.day_index} day={day} />)}
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
