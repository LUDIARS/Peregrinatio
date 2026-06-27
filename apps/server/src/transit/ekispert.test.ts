// ekispert 応答→DepartureExtract の写像 (純関数) の単体テスト。
// 実応答は契約キーでの実走で要検証だが、配列/単体・時刻表記の揺れに対する防御を固定する。
import { describe, expect, it } from 'vitest';
import { mapEkispertDepartures } from './ekispert.js';

describe('mapEkispertDepartures', () => {
  it('Course 配列の各乗車区間を 1 便として写す', () => {
    const json = {
      ResultSet: {
        Course: [
          {
            Price: [{ kind: 'Fare', Oneway: '14380' }],
            Route: {
              Line: [
                { Name: 'かがやき501号', Departure: '2026-07-01T08:00:00', Arrival: '2026-07-01T10:30:00', StartPlatform: { Name: '14番線' } },
              ],
            },
          },
          {
            Route: {
              Line: [
                { Name: 'はくたか', Departure: { text: '09:12' }, Arrival: { Datetime: { text: '2026-07-01T11:40:00' } } },
              ],
            },
          },
        ],
      },
    };
    const out = mapEkispertDepartures(json);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      depart_time: '08:00', arrive_time: '10:30', train_name: 'かがやき501号',
      platform: '14番線', fare_text: '¥14380', note: null,
    });
    expect(out[1]).toEqual({
      depart_time: '09:12', arrive_time: '11:40', train_name: 'はくたか',
      platform: null, fare_text: null, note: null,
    });
  });

  it('Course が単体オブジェクトでも配列化して扱う', () => {
    const json = {
      ResultSet: {
        Course: { Route: { Line: { Name: 'のぞみ', Departure: '06:00', Arrival: '08:30' } } },
      },
    };
    const out = mapEkispertDepartures(json);
    expect(out).toHaveLength(1);
    expect(out[0]?.train_name).toBe('のぞみ');
    expect(out[0]?.depart_time).toBe('06:00');
  });

  it('ResultSet/Course が無ければ空配列 (例外にしない)', () => {
    expect(mapEkispertDepartures({})).toEqual([]);
    expect(mapEkispertDepartures({ ResultSet: {} })).toEqual([]);
    expect(mapEkispertDepartures(null)).toEqual([]);
  });

  it('時刻が読めない Course は捨てる', () => {
    const json = { ResultSet: { Course: [{ Route: { Line: [{ Name: '不明' }] } }] } };
    expect(mapEkispertDepartures(json)).toEqual([]);
  });
});
