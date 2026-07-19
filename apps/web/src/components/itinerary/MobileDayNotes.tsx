import { useEffect, useState } from 'react';
import type { TripDay } from '../../types.js';
import { DayNotesEditor, dayDisplayName } from './DayNotesEditor.js';

interface MobileDayNotesProps {
  days: TripDay[];
  onSave: (dayId: string, value: string | null) => Promise<void>;
}

/** Mobile-only shortcut and overlay for reviewing every day's memo without horizontal scrolling. */
export function MobileDayNotes({ days, onSave }: MobileDayNotesProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  return (
    <div className="mobile-day-notes">
      <button
        type="button"
        className="mobile-day-notes-fab"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        📝 日別メモ
      </button>
      {open && (
        <div className="mobile-day-notes-backdrop" onClick={() => setOpen(false)}>
          <section
            className="mobile-day-notes-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="日別メモ"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="mobile-day-notes-head">
              <strong>📝 日別メモ</strong>
              <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="閉じる">✕</button>
            </header>
            <div className="mobile-day-notes-list">
              {days.map((day) => (
                <section key={day.id} className="mobile-day-notes-item">
                  <h3>{dayDisplayName(day)}</h3>
                  {day.date && <div className="muted mobile-day-notes-date">{day.date}</div>}
                  <DayNotesEditor day={day} onSave={onSave} />
                </section>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
