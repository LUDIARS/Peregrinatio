import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TripDay } from '../../types.js';
import { DayNotesEditor } from './DayNotesEditor.js';
import { PersistedNoteEditor } from './PersistedNoteEditor.js';

const day: TripDay = {
  id: 'day-1',
  trip_id: 'trip-1',
  day_index: 0,
  date: '2026-07-20',
  title: '到着日',
  notes: '雨具を忘れない',
};

describe('旅のしおりメモ', () => {
  it('日別メモを日名と保存済み内容つきで表示する', () => {
    const html = renderToStaticMarkup(<DayNotesEditor day={day} onSave={async () => undefined} />);

    expect(html).toContain('aria-label="到着日のメモ"');
    expect(html).toContain('その日のメモ');
    expect(html).toContain('雨具を忘れない');
  });

  it('場所メモが空でも編集欄を表示する', () => {
    const html = renderToStaticMarkup(
      <PersistedNoteEditor
        label="場所メモ"
        value={null}
        placeholder="展望台についてのメモ"
        onSave={async () => undefined}
      />,
    );

    expect(html).toContain('場所メモ');
    expect(html).toContain('展望台についてのメモ');
    expect(html).toContain('<textarea');
  });
});
