import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAN_INPUT, normalizePlanInput } from './plan-input.js';
import { formatHhmm, parseHhmm } from './plan-time.js';

describe('parseHhmm / formatHhmm', () => {
  it('HH:MM と分を往復できる', () => {
    expect(parseHhmm('09:30')).toBe(570);
    expect(formatHhmm(570)).toBe('09:30');
  });
  it('不正な時刻は null', () => {
    expect(parseHhmm('25:00')).toBeNull();
    expect(parseHhmm('9')).toBeNull();
    expect(parseHhmm(null)).toBeNull();
  });
  it('24 時を超える分は 23:59 で止める', () => {
    expect(formatHhmm(24 * 60 + 30)).toBe('23:59');
  });
});

describe('normalizePlanInput', () => {
  it('未指定は既定になる', () => {
    expect(normalizePlanInput({})).toEqual(DEFAULT_PLAN_INPUT);
  });
  it('交通手段とペースの不正値は既定に戻る', () => {
    const v = normalizePlanInput({ primary_mode: 'teleport', pace: 'insane' });
    expect(v.primary_mode).toBe('transit');
    expect(v.pace).toBe('standard');
  });
  it('活動時間帯が短すぎる指定は既定に戻る', () => {
    const v = normalizePlanInput({ day_start: '09:00', day_end: '09:30' });
    expect(v.day_start).toBe(DEFAULT_PLAN_INPUT.day_start);
    expect(v.day_end).toBe(DEFAULT_PLAN_INPUT.day_end);
  });
  it('妥当な活動時間帯はそのまま通る', () => {
    const v = normalizePlanInput({ day_start: '07:30', day_end: '20:00' });
    expect(v.day_start).toBe('07:30');
    expect(v.day_end).toBe('20:00');
  });
  it('id 配列は文字列だけ残す', () => {
    expect(normalizePlanInput({ must_place_ids: ['a', 1, null, 'b'] }).must_place_ids).toEqual(['a', 'b']);
  });
  it('use_routes_api は明示 true のときだけ立つ', () => {
    expect(normalizePlanInput({ use_routes_api: 'yes' }).use_routes_api).toBe(false);
    expect(normalizePlanInput({ use_routes_api: true }).use_routes_api).toBe(true);
  });
});
