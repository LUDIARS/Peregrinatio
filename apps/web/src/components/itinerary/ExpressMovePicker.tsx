// @implements SPEC-EXPRESS-ITINERARY
import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import type { ExpressLineDetail, ExpressLineSummary, ExpressSegment, Timetable, TimetableDeparture } from '../../types.js';

/**
 * しおりの「移動を追加」に、新幹線・特急の時刻表ライブラリの便を並べる。
 * 路線・乗車駅・降車駅を選ぶと、その日 (date) に走る便を after 以降で出す。
 * 選んだ便は旅の区間ボードへ写してから (adoptExpress)、呼び側が移動カードにする。
 */
export function ExpressMovePicker({
  tripId, date, after, busy, onPicked, onError,
}: {
  tripId: string;
  date: string | null;
  after: string;
  busy: boolean;
  onPicked: (picked: { timetable: Timetable; departure: TimetableDeparture }) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [lines, setLines] = useState<ExpressLineSummary[]>([]);
  const [lineId, setLineId] = useState('');
  const [line, setLine] = useState<ExpressLineDetail | null>(null);
  const [fromSeq, setFromSeq] = useState<number | null>(null);
  const [toSeq, setToSeq] = useState<number | null>(null);
  const [segments, setSegments] = useState<ExpressSegment[] | null>(null);
  const [adopting, setAdopting] = useState(false);

  useEffect(() => {
    api.listExpressLines().then(setLines)
      .catch((e: unknown) => onError(e instanceof Error ? e.message : '時刻表ライブラリを読めませんでした'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLine(null); setFromSeq(null); setToSeq(null); setSegments(null);
    if (!lineId) return;
    api.getExpressLine(lineId).then(setLine)
      .catch((e: unknown) => onError(e instanceof Error ? e.message : '路線を読めませんでした'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineId]);

  useEffect(() => {
    setSegments(null);
    if (!lineId || fromSeq == null || toSeq == null || fromSeq === toSeq) return;
    api.expressSegments(lineId, { from_seq: fromSeq, to_seq: toSeq, date: date ?? undefined, after: after || undefined })
      .then(setSegments)
      .catch((e: unknown) => onError(e instanceof Error ? e.message : '便を読めませんでした'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineId, fromSeq, toSeq, date, after]);

  const pick = async (s: ExpressSegment) => {
    if (fromSeq == null || toSeq == null) return;
    setAdopting(true);
    try {
      await onPicked(await api.adoptExpress(tripId, { train_id: s.train_id, from_seq: fromSeq, to_seq: toSeq }));
    } catch (e) { onError(e instanceof Error ? e.message : '便を追加できませんでした'); }
    finally { setAdopting(false); }
  };

  if (lines.length === 0) {
    return <p className="muted">新幹線・特急の時刻表がまだありません (「時刻表/運行情報」の「新幹線・特急の時刻表」で取り込めます)。</p>;
  }
  const stationSelect = (value: number | null, set: (v: number | null) => void, label: string) => (
    <select value={value ?? ''} onChange={(e) => set(e.target.value === '' ? null : Number(e.target.value))} aria-label={label}>
      <option value="">{label}</option>
      {line?.stations.map((s) => <option key={s.seq} value={s.seq}>{s.name}</option>)}
    </select>
  );

  return (
    <div className="stack">
      <div className="row" style={{ gap: 6 }}>
        <select value={lineId} onChange={(e) => setLineId(e.target.value)} aria-label="路線">
          <option value="">路線を選ぶ</option>
          {lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        {line && stationSelect(fromSeq, setFromSeq, '乗車駅')}
        {line && <span>→</span>}
        {line && stationSelect(toSeq, setToSeq, '降車駅')}
      </div>
      {segments && segments.length === 0 && <p className="muted">条件に合う便がありません。</p>}
      {segments?.map((s) => (
        <button key={s.train_id} type="button" className="card card-link" disabled={busy || adopting} onClick={() => void pick(s)}>
          <strong>{s.depart_time} → {s.arrive_time}</strong>
          <div className="muted">
            {line?.name} {s.train_name}
            {s.verdict === 'unknown' ? ` ｜ 運行日「${s.service_note}」は要確認` : ''}
          </div>
        </button>
      ))}
    </div>
  );
}
