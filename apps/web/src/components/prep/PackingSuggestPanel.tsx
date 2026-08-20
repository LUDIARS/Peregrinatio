import { useState } from 'react';
import { api } from '../../api.js';
import { PackingDropList, PackingSuggestList } from './PackingSuggestList.js';
import type { PackingSuggestResult } from '../../types.js';

/**
 * 持ち物の提案パネル。
 * 「提案する」で候補を出し (この時点では持ち物リストは変わらない)、
 * チェックした分だけを「持ち物に追加」で反映する。
 */
export function PackingSuggestPanel({ tripId, onAdopted }: { tripId: string; onAdopted: () => Promise<void> }) {
  const [result, setResult] = useState<PackingSuggestResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [removals, setRemovals] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const run = async () => {
    setBusy(true); setError(''); setDone('');
    try {
      const res = await api.suggestPacking(tripId);
      setResult(res);
      // 既にリストにあるものは既定で外す (重複追加を避ける)。
      setSelected(new Set(res.suggestions.filter((s) => !s.already_listed).map((s) => s.key)));
      setRemovals(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : '提案の取得に失敗しました');
    } finally { setBusy(false); }
  };

  const toggle = (key: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key); else next.delete(key);
      return next;
    });
  };

  const toggleRemoval = (itemId: string, checked: boolean) => {
    setRemovals((prev) => {
      const next = new Set(prev);
      if (checked) next.add(itemId); else next.delete(itemId);
      return next;
    });
  };

  const adopt = async () => {
    if (!result) return;
    setBusy(true); setError(''); setDone('');
    try {
      const items = result.suggestions
        .filter((s) => selected.has(s.key))
        .map((s) => ({ title: s.title, quantity: s.quantity, category: s.category, reason: s.reason }));
      const res = await api.adoptPacking(tripId, { items, remove_item_ids: [...removals] });
      setDone(`${res.created.length} 件を追加${res.removed > 0 ? ` / ${res.removed} 件を削除` : ''}${res.skipped > 0 ? ` (重複 ${res.skipped} 件はスキップ)` : ''}しました。`);
      setResult(null);
      setSelected(new Set());
      setRemovals(new Set());
      await onAdopted();
    } catch (e) {
      setError(e instanceof Error ? e.message : '採用に失敗しました');
    } finally { setBusy(false); }
  };

  return (
    <section className="prep-section">
      <div className="spread">
        <h3 style={{ margin: 0 }}>持ち物の提案</h3>
        <button type="button" className="sm" onClick={() => void run()} disabled={busy}>
          {busy ? '考え中...' : '提案する'}
        </button>
      </div>
      <p className="muted">宿・行き先の設備と、旅の季節から持ち物を提案します。追加するのはチェックした分だけです。</p>

      {error && <div className="error" style={{ marginTop: 6 }}>{error}</div>}
      {done && <div className="card" style={{ marginTop: 6 }}>{done}</div>}

      {result && (
        <>
          <div className="prep-meta" style={{ marginTop: 8 }}>
            {result.season_label && <span className="chip">{result.season_label}</span>}
            {result.nights != null && <span className="chip">{result.nights} 泊</span>}
            {result.facilities.slice(0, 8).map((f) => <span key={f} className="chip">{f}</span>)}
          </div>

          {result.hints.length > 0 && (
            <div className="card" style={{ marginTop: 8 }}>
              {result.hints.map((h) => (
                <p key={h.key} className="muted" style={{ margin: '4px 0' }}>
                  <strong>{h.label}</strong> — {h.detail}
                </p>
              ))}
            </div>
          )}

          {result.warnings.map((w) => (
            <div key={w} className="muted" style={{ marginTop: 6 }}>⚠ {w}</div>
          ))}

          <div style={{ marginTop: 8 }}>
            <PackingSuggestList suggestions={result.suggestions} selected={selected} onToggle={toggle} />
          </div>
          <PackingDropList drops={result.drops} selected={removals} onToggle={toggleRemoval} />

          <button
            type="button"
            style={{ marginTop: 8 }}
            onClick={() => void adopt()}
            disabled={busy || (selected.size === 0 && removals.size === 0)}
          >
            {busy ? '反映中...' : `選んだ ${selected.size} 件を持ち物に追加${removals.size > 0 ? ` / ${removals.size} 件を削除` : ''}`}
          </button>
        </>
      )}
    </section>
  );
}
