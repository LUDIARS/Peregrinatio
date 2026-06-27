// crawl-llm の LLM 応答パーサ (純関数) の単体テスト。
import { describe, expect, it } from 'vitest';
import { asText, normTime, parseAlerts, parseDepartures } from './parse.js';

describe('normTime', () => {
  it('HH:MM を 0 埋め正規化する', () => {
    expect(normTime('8:05')).toBe('08:05');
    expect(normTime('23:59')).toBe('23:59');
    expect(normTime('25:10')).toBe('25:10'); // 深夜便表記を許容
  });
  it('不正値は null', () => {
    expect(normTime('48:00')).toBeNull();
    expect(normTime('8時5分')).toBeNull();
    expect(normTime(800)).toBeNull();
    expect(normTime(null)).toBeNull();
  });
});

describe('asText', () => {
  it('trim し、空/非文字列は null', () => {
    expect(asText('  かがやき ')).toBe('かがやき');
    expect(asText('   ')).toBeNull();
    expect(asText(42)).toBeNull();
  });
});

describe('parseDepartures', () => {
  it('{ departures: [...] } を抽出する', () => {
    const raw = JSON.stringify({
      departures: [
        { depart_time: '8:00', arrive_time: '10:30', train_name: 'かがやき501号', platform: '14', fare_text: '¥14380', note: '' },
        { depart: '9:12', arrival: '11:40', name: 'はくたか' },
      ],
    });
    const out = parseDepartures(raw);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      depart_time: '08:00', arrive_time: '10:30', train_name: 'かがやき501号',
      platform: '14', fare_text: '¥14380', note: null,
    });
    expect(out[1]?.depart_time).toBe('09:12');
    expect(out[1]?.train_name).toBe('はくたか');
  });

  it('素の配列やフェンス付き JSON も扱える', () => {
    const raw = '```json\n[{ "depart_time": "07:00" }]\n```';
    expect(parseDepartures(raw)).toEqual([
      { depart_time: '07:00', arrive_time: null, train_name: null, platform: null, fare_text: null, note: null },
    ]);
  });

  it('時刻が全く無い行は捨てる', () => {
    const raw = JSON.stringify({ departures: [{ train_name: '時刻不明' }, { depart_time: '06:00' }] });
    const out = parseDepartures(raw);
    expect(out).toHaveLength(1);
    expect(out[0]?.depart_time).toBe('06:00');
  });

  it('JSON が無ければ例外 (握り潰さない)', () => {
    expect(() => parseDepartures('便はありません')).toThrow();
  });
});

describe('parseAlerts', () => {
  it('{ alerts: [...] } を抽出し severity を丸める', () => {
    const raw = JSON.stringify({
      alerts: [
        { line_name: '北陸新幹線', severity: 'WARNING', title: '遅延', body: '大雪の影響', source_url: 'https://x' },
        { level: 'unknown-sev', detail: '平常運転に近い' },
      ],
    });
    const out = parseAlerts(raw);
    expect(out).toHaveLength(2);
    expect(out[0]?.severity).toBe('warning');
    expect(out[1]?.severity).toBe('info'); // 未知は info
    expect(out[1]?.body).toBe('平常運転に近い');
  });

  it('title も body も無い行は捨てる', () => {
    const raw = JSON.stringify({ alerts: [{ line_name: '空' }] });
    expect(parseAlerts(raw)).toHaveLength(0);
  });
});
