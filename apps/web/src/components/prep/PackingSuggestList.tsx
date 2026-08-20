import type { PackingDrop, PackingSuggestion, SuggestSource } from '../../types.js';

const SOURCE_LABEL: Record<SuggestSource, string> = {
  facility: '設備',
  season: '季節',
  baseline: '基本',
  llm: 'この旅',
};

/** 提案 1 件の行。チェックを外した分は採用されない。 */
function SuggestionRow({
  item, checked, onToggle,
}: {
  item: PackingSuggestion;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}) {
  return (
    <article className={`card prep-item${item.already_listed ? ' is-done' : ''}`}>
      <div className="prep-item-main">
        <label className="prep-check">
          <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} />
          <span>{item.title}</span>
        </label>
        {item.quantity != null && <span className="muted">x{item.quantity}</span>}
      </div>
      <div className="prep-meta">
        <span className="chip">{SOURCE_LABEL[item.source]}</span>
        {item.category && <span className="chip">{item.category}</span>}
        {item.origins.map((o) => <span key={o} className="chip">{o}</span>)}
        {item.already_listed && <span className="muted">既にリストにあります</span>}
      </div>
      <p className="muted prep-details">{item.reason}</p>
    </article>
  );
}

/** 提案リスト本体 (カテゴリごとにまとめて表示)。 */
export function PackingSuggestList({
  suggestions, selected, onToggle,
}: {
  suggestions: PackingSuggestion[];
  selected: Set<string>;
  onToggle: (key: string, checked: boolean) => void;
}) {
  if (suggestions.length === 0) return <p className="muted">提案できる持ち物がありませんでした。</p>;
  return (
    <div className="stack prep-list">
      {suggestions.map((s) => (
        <SuggestionRow
          key={s.key}
          item={s}
          checked={selected.has(s.key)}
          onToggle={(checked) => onToggle(s.key, checked)}
        />
      ))}
    </div>
  );
}

/** 「現地にあるので持っていかなくてよい」もの。既存の行があるときだけ削除を選べる。 */
export function PackingDropList({
  drops, selected, onToggle,
}: {
  drops: PackingDrop[];
  selected: Set<string>;
  onToggle: (itemId: string, checked: boolean) => void;
}) {
  if (drops.length === 0) return null;
  return (
    <section className="prep-section">
      <h4 style={{ margin: '8px 0' }}>持っていかなくてよいもの</h4>
      <div className="stack prep-list">
        {drops.map((d) => (
          <article key={d.title} className="card prep-item">
            <div className="prep-item-main">
              {d.existing_item_id ? (
                <label className="prep-check">
                  <input
                    type="checkbox"
                    checked={selected.has(d.existing_item_id)}
                    onChange={(e) => onToggle(d.existing_item_id as string, e.target.checked)}
                  />
                  <span>{d.title} をリストから外す</span>
                </label>
              ) : (
                <span>{d.title}</span>
              )}
            </div>
            <div className="prep-meta">
              {d.origins.map((o) => <span key={o} className="chip">{o}</span>)}
            </div>
            <p className="muted prep-details">{d.reason}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
