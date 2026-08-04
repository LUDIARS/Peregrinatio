import { useEffect, useState } from 'react';
import { placeTypeColor } from '../../lib/maps.js';

interface Props {
  /** 選択肢 (表示ラベル)。空なら何も描画しない。 */
  types: readonly string[];
  selected: readonly string[];
  onToggle: (type: string) => void;
  onClear: () => void;
}

/** 場所タイプの絞り込み。トリガー + ポップオーバーで開閉する (地図上部/一覧の両方から使う)。 */
export function PlaceTypeFilter({ types, selected, onToggle, onClear }: Props) {
  const [open, setOpen] = useState(false);

  // 選択肢が消えたら開いたままにしない (空のポップオーバーが残るのを防ぐ)。
  useEffect(() => {
    if (types.length === 0) setOpen(false);
  }, [types.length]);

  // Esc で閉じる (バックドロップのタップと同じ挙動)。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (types.length === 0) return null;

  const triggerLabel = selected.length === 0 ? 'すべてのタイプ' : `タイプ ${selected.length}件`;

  return (
    <div className={`place-type-filter${open ? ' open' : ''}`}>
      <button
        type="button"
        className="place-type-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className="base-bar-label">タイプ</span>
        <span className="place-type-trigger-label">{triggerLabel}</span>
      </button>
      {open && (
        <>
          <button
            type="button"
            className="place-type-backdrop"
            aria-label="タイプフィルタを閉じる"
            onClick={() => setOpen(false)}
          />
          <div className="place-type-popover" role="dialog" aria-label="場所タイプフィルタ">
            <div className="place-type-popover-head">
              <strong>タイプ</strong>
              {selected.length > 0 && (
                <button type="button" className="place-type-clear" onClick={onClear}>解除</button>
              )}
            </div>
            <div className="place-type-options">
              {types.map((type) => {
                const active = selected.includes(type);
                return (
                  <button
                    key={type}
                    type="button"
                    className={`place-type-option${active ? ' active' : ''}`}
                    onClick={() => onToggle(type)}
                    aria-pressed={active}
                  >
                    <span className="type-swatch" style={{ background: placeTypeColor(type) }} />
                    <span>{type}</span>
                    <span className="place-type-check">{active ? '✓' : ''}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
