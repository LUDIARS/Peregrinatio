import { describe, expect, it } from 'vitest';
import { suggestForLeg, haversineKm } from './reservation.js';

const TOKYO = { lat: 35.681, lng: 139.767 };

describe('予約サジェスト (新幹線/飛行機の特定)', () => {
  it('東京→新大阪 は東海道・山陽新幹線 (スマートEX)', () => {
    const s = suggestForLeg(TOKYO, { lat: 34.733, lng: 135.500 });
    const sk = s.find((x) => x.mode === 'shinkansen');
    expect(sk).toBeTruthy();
    expect(sk!.title).toBe('東海道・山陽新幹線');
    expect(sk!.url).toContain('smart-ex');
    expect(sk!.from).toBe('東京駅');
    expect(sk!.to).toBe('新大阪駅');
  });

  it('東京→金沢 は北陸新幹線 (えきねっと)。近めなので飛行機は出さない', () => {
    const s = suggestForLeg(TOKYO, { lat: 36.578, lng: 136.648 });
    const sk = s.find((x) => x.mode === 'shinkansen');
    expect(sk!.title).toBe('北陸新幹線');
    expect(sk!.url).toContain('eki-net');
    expect(s.find((x) => x.mode === 'flight')).toBeFalsy();
  });

  it('東京→札幌 は新幹線圏外なので飛行機 (HND→CTS)', () => {
    const s = suggestForLeg(TOKYO, { lat: 43.062, lng: 141.354 });
    expect(s.find((x) => x.mode === 'shinkansen')).toBeFalsy();
    const fl = s.find((x) => x.mode === 'flight');
    expect(fl).toBeTruthy();
    expect(fl!.from).toContain('HND');
    expect(fl!.to).toContain('CTS');
  });

  it('東京→博多 は新幹線と飛行機の両方を提示する', () => {
    const s = suggestForLeg(TOKYO, { lat: 33.590, lng: 130.421 });
    expect(s.find((x) => x.mode === 'shinkansen')?.title).toBe('東海道・山陽新幹線');
    expect(s.find((x) => x.mode === 'flight')).toBeTruthy();
  });

  it('近距離 (<150km) はサジェストしない', () => {
    expect(suggestForLeg(TOKYO, { lat: 35.44, lng: 139.638 })).toHaveLength(0); // 横浜近辺
  });

  it('haversineKm: 東京→新大阪 はおおよそ 400km', () => {
    const km = haversineKm(TOKYO, { lat: 34.733, lng: 135.500 });
    expect(km).toBeGreaterThan(350);
    expect(km).toBeLessThan(450);
  });
});
