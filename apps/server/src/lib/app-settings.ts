// アプリ全体の設定 (旅をまたいで使い回す単一値) を key/value で永続化する薄いラッパー。
// 例: 自宅住所 (home_location)。秘密ではないので暗号化 config ではなく DB の app_settings に置く。

import { sql } from '../db/index.js';
import { nowIso } from './ids.js';

export async function getSetting(key: string): Promise<string | null> {
  const rows = (await sql`SELECT value FROM app_settings WHERE key=${key}`) as { value: string | null }[];
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await sql`
    INSERT INTO app_settings (key, value, updated_at) VALUES (${key}, ${value}, ${nowIso()})
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`;
}

export async function deleteSetting(key: string): Promise<void> {
  await sql`DELETE FROM app_settings WHERE key=${key}`;
}
