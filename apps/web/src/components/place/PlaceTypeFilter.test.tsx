import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlaceTypeFilter } from './PlaceTypeFilter.js';

const noop = () => undefined;

describe('場所タイプフィルタ', () => {
  it('選択肢が無ければ何も描画しない', () => {
    const html = renderToStaticMarkup(
      <PlaceTypeFilter types={[]} selected={[]} onToggle={noop} onClear={noop} />,
    );

    expect(html).toBe('');
  });

  it('未選択ならすべてのタイプと表示し、閉じたまま描画する', () => {
    const html = renderToStaticMarkup(
      <PlaceTypeFilter types={['カフェ', '駅']} selected={[]} onToggle={noop} onClear={noop} />,
    );

    expect(html).toContain('すべてのタイプ');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('place-type-popover');
  });

  it('選択中は件数をトリガーに出す', () => {
    const html = renderToStaticMarkup(
      <PlaceTypeFilter types={['カフェ', '駅']} selected={['カフェ']} onToggle={noop} onClear={noop} />,
    );

    expect(html).toContain('タイプ 1件');
  });
});
