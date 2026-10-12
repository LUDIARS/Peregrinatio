// @implements SPEC-EXPRESS-UI
import { useState } from 'react';
import { api } from '../../api.js';
import type { ExpressOption, ExpressSuggestResult } from '../../types.js';

function terminalText(o: ExpressOption): string {
  const t = o.terminal;
  const how = t.source === 'gtfs' ? `🚌 ${t.service_label ?? 'バス'}` : '🚕 タクシー (概算)';
  return `${t.from_label} ${t.depart_time} → ${t.to_label} ${t.arrive_time} (${how}, ${t.duration_min}分)`;
}

function OptionCard({ o, onAdopt, busy }: { o: ExpressOption; onAdopt: (o: ExpressOption) => void; busy: boolean }) {
  return (
    <div className="card">
      <div className="spread">
        <strong>{o.train_name} {o.board_station} {o.depart_time} → {o.alight_station} {o.arrive_time}</strong>
        <button type="button" className="sm" disabled={busy} onClick={() => onAdopt(o)}>区間ボードへ</button>
      </div>
      <div className="muted">
        {o.direction === 'outbound'
          ? `家を出る ${o.access.time} (駅まで約 ${o.access.duration_min} 分の概算) ／ ${terminalText(o)}`
          : `${terminalText(o)} ／ 家に着く ${o.access.time} ごろ`}
      </div>
    </div>
  );
}

/**
 * この旅の往路・復路の便を、取り込んだ新幹線・特急の時刻表から提案する。
 * 提案は DB を変えない。「区間ボードへ」で旅の区間ボードに写し、しおりの移動カードにできる。
 */
export function ExpressTripSuggest({
  tripId, onAdopted, onError,
}: {
  tripId: string;
  onAdopted: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [result, setResult] = useState<ExpressSuggestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState('');

  const run = async () => {
    setBusy(true); onError(''); setInfo('');
    try { setResult(await api.suggestExpress(tripId)); }
    catch (e) { onError(e instanceof Error ? e.message : '往復便を提案できませんでした'); }
    finally { setBusy(false); }
  };

  const adopt = async (o: ExpressOption) => {
    setBusy(true); onError('');
    try {
      await api.adoptExpress(tripId, { train_id: o.train_id, from_seq: o.board_seq, to_seq: o.alight_seq });
      setInfo(`${o.train_name} (${o.depart_time} 発) を区間ボードに写しました。しおりの「移動を追加」から選べます。`);
      await onAdopted();
    } catch (e) { onError(e instanceof Error ? e.message : '便を写せませんでした'); }
    finally { setBusy(false); }
  };

  return (
    <div className="card stack">
      <div className="spread">
        <strong>この旅の往復便</strong>
        <button type="button" className="sm" disabled={busy} onClick={() => void run()}>{busy ? '探しています…' : '便を提案'}</button>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        出発地点に近い駅から拠点に近い駅まで、チェックインに間に合う往路とチェックアウト後の復路を探します。
      </p>
      {info && <div className="muted">{info}</div>}
      {result && (
        <>
          {result.warnings.map((w) => <div key={w} className="muted">⚠ {w}</div>)}
          <strong>往路</strong>
          {result.outbound.length === 0 && <p className="muted">候補がありません。</p>}
          {result.outbound.map((o, i) => <OptionCard key={`o-${o.train_id}-${i}`} o={o} onAdopt={(x) => void adopt(x)} busy={busy} />)}
          <strong>復路</strong>
          {result.inbound.length === 0 && <p className="muted">候補がありません。</p>}
          {result.inbound.map((o, i) => <OptionCard key={`i-${o.train_id}-${i}`} o={o} onAdopt={(x) => void adopt(x)} busy={busy} />)}
        </>
      )}
    </div>
  );
}
