import { describe, expect, it } from 'vitest';
import { rankAnchors } from './plan-anchors.js';
import type { TripPlace } from '../types.js';

function place(id: string, name: string, over: Partial<TripPlace> = {}): TripPlace {
  return {
    id, name, address: null, lat: 35.0, lng: 135.0, category: null,
    source_url: null, summary: null, notes: null, image_url: null,
    status: 'none', status_by: null, google_place_id: null,
    created_at: '2026-01-01', updated_at: '2026-01-01',
    is_base: 0, base_name: null, base_name_source: null,
    checkin_time: null, checkout_time: null, postponed: 0,
    ...over,
  };
}

describe('rankAnchors — must 指定の優先', () => {
  it('must 指定は「気になる」より先に来る', () => {
    const ranked = rankAnchors(
      [place('p1', '気になる場所', { status: 'interested' }), place('p2', '必ず行く場所')],
      new Set(['p2']),
    );
    expect(ranked[0]?.place.id).toBe('p2');
    expect(ranked[0]?.reason).toContain('必ず行くと指定した場所');
  });

  it('must 指定は訪問済みの減点があっても先頭に来る', () => {
    const ranked = rankAnchors(
      [place('p1', '気になる場所', { status: 'interested' }), place('p2', '訪問済みだが必須', { status: 'visited' })],
      new Set(['p2']),
    );
    expect(ranked[0]?.place.id).toBe('p2');
  });

  it('must 指定が無ければ従来どおりスコア順', () => {
    const ranked = rankAnchors([place('p1', 'ただの場所'), place('p2', '気になる場所', { status: 'interested' })]);
    expect(ranked[0]?.place.id).toBe('p2');
  });

  it('mustIds を渡さなくても index が誤ってスコアに効かない', () => {
    const ranked = rankAnchors([place('p1', 'A'), place('p2', 'B'), place('p3', 'C')]);
    expect(ranked.every((r) => r.score === 0)).toBe(true);
  });
});
