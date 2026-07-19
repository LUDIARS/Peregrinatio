import type { TripDay } from '../../types.js';
import { PersistedNoteEditor } from './PersistedNoteEditor.js';

interface DayNotesEditorProps {
  day: TripDay;
  onSave: (dayId: string, value: string | null) => Promise<void>;
  className?: string;
}

export function dayDisplayName(day: TripDay): string {
  return day.title || `${day.day_index + 1} 日目`;
}

/** Edits the memo attached to one trip day. */
export function DayNotesEditor({ day, onSave, className = '' }: DayNotesEditorProps) {
  return (
    <aside className={`day-notes-editor ${className}`.trim()} aria-label={`${dayDisplayName(day)}のメモ`}>
      <PersistedNoteEditor
        label="📝 その日のメモ"
        value={day.notes}
        placeholder="持ち物、集合時刻、その日に確認したいことなど"
        onSave={(value) => onSave(day.id, value)}
        rows={6}
      />
    </aside>
  );
}
