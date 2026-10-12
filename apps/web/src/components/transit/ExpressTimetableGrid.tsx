// @implements SPEC-EXPRESS-UI
import type { ExpressDirection, ExpressStation, ExpressTrain } from '../../types.js';

/** 停車時刻の 1 セル。着発が両方あれば「着/発」、通過・非経由は空。 */
function cell(train: ExpressTrain, seq: number): string {
  const s = train.stops.find((x) => x.station_seq === seq);
  if (!s) return '';
  if (s.arrive_time && s.depart_time && s.arrive_time !== s.depart_time) return `${s.arrive_time}着 ${s.depart_time}発`;
  return s.depart_time ?? s.arrive_time ?? '';
}

/**
 * 縦に駅、横に列車の表 (紙の時刻表と同じ向き)。上り表は駅を上り方向 (seq の逆) に並べる。
 * プレビューと路線詳細の両方で使う読み取り専用の表。
 */
export function ExpressTimetableGrid({
  stations, trains, direction,
}: {
  stations: ExpressStation[];
  trains: ExpressTrain[];
  direction: ExpressDirection;
}) {
  const list = trains.filter((t) => t.direction === direction);
  if (list.length === 0) return <p className="muted">{direction === 'down' ? '下り' : '上り'}の列車はありません。</p>;
  const ordered = direction === 'down' ? stations : [...stations].reverse();
  return (
    <div className="express-table-wrap">
      <table className="express-table">
        <thead>
          <tr>
            <th>{direction === 'down' ? '下り' : '上り'}</th>
            {list.map((t, i) => (
              <th key={t.id ?? `${t.train_name}-${i}`}>
                {t.train_name}
                {t.service_note !== 'daily' && <div className="muted">{t.service_note === 'weekday' ? '平日' : t.service_note === 'holiday' ? '休日' : t.service_note}</div>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.map((s) => (
            <tr key={s.seq}>
              <td>{s.name}</td>
              {list.map((t, i) => <td key={t.id ?? `${t.train_name}-${i}`}>{cell(t, s.seq) || '↓'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
