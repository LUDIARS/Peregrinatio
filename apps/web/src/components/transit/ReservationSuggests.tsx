import type { ReservationSuggestion } from '../../types.js';

/** 予約サジェスト (新幹線/飛行機)。出発地点+目的地の座標から予約サイトを提案する。 */
export function ReservationSuggests({ suggests, origin }: { suggests: ReservationSuggestion[]; origin: string | null }) {
  if (suggests.length === 0) return null;
  return (
    <div className="card reservation-suggest">
      <strong>🎫 予約サジェスト{origin ? `（${origin} 起点）` : ''}</strong>
      <p className="muted" style={{ margin: '4px 0 8px' }}>
        出発地点と目的地の位置から、利用しそうな新幹線/飛行機の予約サイトを提案します（主要路線のみ）。
      </p>
      <div className="stack">
        {suggests.map((s, i) => (
          <a key={`${s.mode}-${i}`} href={s.url} target="_blank" rel="noreferrer"
            className="card card-link reservation-row">
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 18 }}>{s.mode === 'shinkansen' ? '🚄' : '✈'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{s.title}</strong>
                <div className="muted" style={{ fontSize: 13 }}>
                  {s.from} → {s.to}（{s.destination}・約{s.distance_km}km）
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {s.operator}{s.note ? ` ｜ ${s.note}` : ''}
                </div>
              </div>
              <span className="chip">予約 ↗</span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
