import { describe, expect, it } from 'vitest';
import { hhmmToMin, minToHhmm, adjustOptionToTarget } from './transit-adjust.js';
import type { TransitOption } from '../types.js';

const opt = (over: Partial<TransitOption> = {}): TransitOption => ({
  depart_time: '18:11', arrive_time: '18:27', duration_min: 16, fare_yen: 260, interval_min: 5, summary: '中央線',
  ...over,
});

describe('hhmm 変換', () => {
  it('往復', () => {
    expect(hhmmToMin('08:05')).toBe(485);
    expect(minToHhmm(485)).toBe('08:05');
  });
  it('不正は null', () => {
    expect(hhmmToMin('25:00')).toBeNull();
    expect(hhmmToMin('abc')).toBeNull();
    expect(hhmmToMin(null)).toBeNull();
  });
});

describe('adjustOptionToTarget', () => {
  it('目標までに着く最も遅い便に逆算 (運行間隔で前倒し)', () => {
    // 18:27着/16分/5分間隔 を目標14:00に逆算。14:00以下で最も近い到着は 13:57、出発 13:41。
    const a = adjustOptionToTarget(opt(), hhmmToMin('14:00')!);
    expect(a).not.toBeNull();
    expect(a!.arrive_time).toBe('13:57');
    expect(a!.depart_time).toBe('13:41');
  });

  it('目標ちょうどに着ける場合はその便', () => {
    const a = adjustOptionToTarget(opt({ arrive_time: '18:27', interval_min: 5 }), hhmmToMin('18:32')!);
    // 18:32以下で最も近い到着は 18:32 (18:27+5)。
    expect(a!.arrive_time).toBe('18:32');
  });

  it('運行間隔が無ければ調整不可 (null)', () => {
    expect(adjustOptionToTarget(opt({ interval_min: null }), 600)).toBeNull();
  });

  it('到着時刻が無ければ調整不可 (null)', () => {
    expect(adjustOptionToTarget(opt({ arrive_time: null }), 600)).toBeNull();
  });
});
