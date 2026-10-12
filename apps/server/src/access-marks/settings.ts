// アクセス印の設定 (タクシー初乗り距離)。app_settings の key/value に置く。
// 地域ごとの運賃表は持たない (正確な表を保守できないため)。印には使った閾値を添える。
// @implements SPEC-ACCESS-SETTINGS

import { deleteSetting, getSetting, setSetting } from '../lib/app-settings.js';

const TAXI_FIRST_FARE_KEY = 'taxi_first_fare_m';
export const DEFAULT_TAXI_FIRST_FARE_M = 1_200;
export const MIN_TAXI_FIRST_FARE_M = 300;
export const MAX_TAXI_FIRST_FARE_M = 10_000;

export function isValidTaxiFirstFare(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
    && value >= MIN_TAXI_FIRST_FARE_M && value <= MAX_TAXI_FIRST_FARE_M;
}

/** 保存値。壊れた値は黙って既定に戻さず例外にする (設定ページで直せるように原因を出す)。 */
export async function getTaxiFirstFareM(): Promise<{ value: number; is_default: boolean }> {
  const raw = await getSetting(TAXI_FIRST_FARE_KEY);
  if (raw == null) return { value: DEFAULT_TAXI_FIRST_FARE_M, is_default: true };
  const n = Number(raw);
  if (!isValidTaxiFirstFare(n)) throw new Error(`app_settings.${TAXI_FIRST_FARE_KEY} が不正です: ${raw}`);
  return { value: n, is_default: false };
}

export async function setTaxiFirstFareM(value: number): Promise<void> {
  await setSetting(TAXI_FIRST_FARE_KEY, String(value));
}

export async function resetTaxiFirstFareM(): Promise<void> {
  await deleteSetting(TAXI_FIRST_FARE_KEY);
}
