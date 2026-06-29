// app_settings の round-trip 回帰テスト。
// バグ: sqlite driver が '{'/'[' 始まりの文字列を JSON へ自動 decode するため、JSON 文字列値
// (自宅 home_location 等) が getSetting でオブジェクト化され、呼び出し側の JSON.parse が壊れて
// 「自宅が保存されない」状態になっていた。getSetting が必ず文字列を返すことを固定する。

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, teardownTestDb } from '../test/db.js';
import { sql } from '../db/index.js';
import { getSetting, setSetting, deleteSetting } from './app-settings.js';
import { getHome, setHome } from '../settings/home.js';

beforeAll(async () => { await setupTestDb(); });
afterAll(async () => { await teardownTestDb(); });
beforeEach(async () => { await sql`DELETE FROM app_settings`; });

describe('app_settings round-trip', () => {
  it('JSON 文字列値を保存しても getSetting は文字列のまま返す', async () => {
    const value = JSON.stringify({ address: '東京', lat: 35.6, lng: 139.7 });
    await setSetting('home_location', value);
    const got = await getSetting('home_location');
    expect(typeof got).toBe('string');
    expect(got).toBe(value);
    expect(JSON.parse(got!)).toMatchObject({ address: '東京', lat: 35.6 });
  });

  it('未設定キーは null', async () => {
    expect(await getSetting('missing')).toBeNull();
  });

  it('home の保存→取得が成立する (回帰)', async () => {
    await setHome({ address: '東京都新宿区', lat: 35.69, lng: 139.69, station: '都庁前駅' });
    const home = await getHome();
    expect(home).not.toBeNull();
    expect(home?.address).toBe('東京都新宿区');
    expect(home?.station).toBe('都庁前駅');
  });

  it('削除すると null になる', async () => {
    await setSetting('k', '{"a":1}');
    await deleteSetting('k');
    expect(await getSetting('k')).toBeNull();
  });
});
