// 自宅 (home) の保存/取得。app_settings の 'home_location' キーに JSON で格納する。
// 旅の出発地点 'home' を選ぶと、ここに保存した座標が旅にスナップショットされる。

import { deleteSetting, getSetting, setSetting } from '../lib/app-settings.js';

const HOME_KEY = 'home_location';

export interface HomeLocation {
  address: string;
  lat: number;
  lng: number;
  station?: string | null;      // 最寄り駅名 (自動取得)
  station_lat?: number | null;
  station_lng?: number | null;
}

export async function getHome(): Promise<HomeLocation | null> {
  const raw = await getSetting(HOME_KEY);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<HomeLocation>;
    if (typeof o.address === 'string' && typeof o.lat === 'number' && typeof o.lng === 'number') {
      return {
        address: o.address, lat: o.lat, lng: o.lng,
        station: o.station ?? null,
        station_lat: o.station_lat ?? null,
        station_lng: o.station_lng ?? null,
      };
    }
  } catch {
    /* 壊れた値は未設定扱い */
  }
  return null;
}

export async function setHome(home: HomeLocation): Promise<void> {
  await setSetting(HOME_KEY, JSON.stringify(home));
}

export async function clearHome(): Promise<void> {
  await deleteSetting(HOME_KEY);
}
