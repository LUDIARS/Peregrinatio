import { useEffect, useState } from 'react';

interface PersistedNoteEditorProps {
  label: string;
  value: string | null;
  placeholder: string;
  onSave: (value: string | null) => Promise<void>;
  className?: string;
  rows?: number;
}

function normalizedNote(value: string | null): string | null {
  return value?.trim() || null;
}

/** A small note form that owns draft, save, and failure state for one persisted note. */
export function PersistedNoteEditor({
  label,
  value,
  placeholder,
  onSave,
  className = '',
  rows = 4,
}: PersistedNoteEditorProps) {
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const nextValue = normalizedNote(draft);
  const isUnchanged = nextValue === normalizedNote(value);

  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving || isUnchanged) return;
    setSaving(true);
    setMessage('');
    try {
      await onSave(nextValue);
      setDraft(nextValue ?? '');
      setMessage('保存しました');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className={`persisted-note-editor ${className}`.trim()}
      onSubmit={(event) => void submit(event)}
      onPointerDown={(event) => event.stopPropagation()}
      onDragStart={(event) => event.preventDefault()}
    >
      <label>
        <span className="persisted-note-label">{label}</span>
        <textarea
          rows={rows}
          value={draft}
          placeholder={placeholder}
          onChange={(event) => {
            setDraft(event.target.value);
            setMessage('');
          }}
        />
      </label>
      <div className="persisted-note-actions">
        <button type="submit" className="sm" disabled={saving || isUnchanged}>
          {saving ? '保存中…' : '保存'}
        </button>
        {message && <span className="persisted-note-message" aria-live="polite">{message}</span>}
      </div>
    </form>
  );
}
