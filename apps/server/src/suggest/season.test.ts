import { describe, expect, it } from 'vitest';
import {
  climateWindowsOf, climateWindowsOfTrip, inMonthDayRange, monthDayNumber,
  seasonalHints, seasonLabelOfTrip, seasonOf,
} from './season.js';

describe('monthDayNumber', () => {
  it('YYYY-MM-DD を MMDD にする', () => {
    expect(monthDayNumber('2026-10-20')).toBe(1020);
    expect(monthDayNumber('2026-01-05')).toBe(105);
  });
  it('日付でなければ null', () => {
    expect(monthDayNumber('2026/10/20')).toBeNull();
    expect(monthDayNumber('2026-02-31')).toBeNull();
    expect(monthDayNumber('')).toBeNull();
  });
});

describe('inMonthDayRange', () => {
  it('年をまたぐ範囲を扱える', () => {
    expect(inMonthDayRange(1225, 1215, 315)).toBe(true);
    expect(inMonthDayRange(120, 1215, 315)).toBe(true);
    expect(inMonthDayRange(601, 1215, 315)).toBe(false);
  });
});

describe('seasonOf', () => {
  it('月ではなく期間で季節を返す', () => {
    expect(seasonOf('2026-04-10')).toBe('spring');
    expect(seasonOf('2026-08-01')).toBe('summer');
    expect(seasonOf('2026-10-20')).toBe('autumn');
    expect(seasonOf('2026-01-15')).toBe('winter');
  });
});

describe('climateWindowsOf', () => {
  it('秋の見頃には紅葉が立つ', () => {
    expect(climateWindowsOf('2026-11-15')).toContain('autumn_leaves');
  });
  it('真夏には猛暑が立つ', () => {
    expect(climateWindowsOf('2026-08-05')).toContain('heat');
  });
  it('9 月上旬は猛暑と台風が重なる', () => {
    const windows = climateWindowsOf('2026-09-05');
    expect(windows).toContain('heat');
    expect(windows).toContain('typhoon');
  });
});

describe('climateWindowsOfTrip', () => {
  it('期間に重なるウィンドウの重複を除く', () => {
    const windows = climateWindowsOfTrip('2026-09-05', '2026-10-20');
    expect(windows).toContain('heat');
    expect(windows).toContain('autumn_leaves');
    expect(new Set(windows).size).toBe(windows.length);
  });
  it('両端が範囲外でも旅行中に重なる気候期間を拾う', () => {
    expect(climateWindowsOfTrip('2026-05-20', '2026-07-20')).toContain('rainy');
    expect(climateWindowsOfTrip('2026-12-01', '2027-04-01')).toContain('snow');
  });
  it('日付が無ければ空', () => {
    expect(climateWindowsOfTrip(null, null)).toEqual([]);
  });
});

describe('seasonalHints', () => {
  it('ウィンドウをヒントに変換する', () => {
    const hints = seasonalHints(['autumn_leaves']);
    expect(hints).toHaveLength(1);
    expect(hints[0]?.label).toBe('紅葉');
  });
});

describe('seasonLabelOfTrip', () => {
  it('開始日を優先する', () => {
    expect(seasonLabelOfTrip('2026-10-20', '2026-12-05')).toBe('秋');
  });
  it('開始日が無ければ終了日で判定する', () => {
    expect(seasonLabelOfTrip(null, '2026-08-01')).toBe('夏');
  });
  it('どちらも無ければ null', () => {
    expect(seasonLabelOfTrip(null, null)).toBeNull();
  });
});
