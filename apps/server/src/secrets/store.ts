// ローカル暗号化 config (@ludiars/encrypted-config) の Peregrinatio 用ラッパー。
// シークレット (API キー) は AES-256-GCM で peregrinatio.config.json に格納する
// (平文 env フォールバックはしない [[feedback_no_env_fallback_for_secrets]] / 非平文 RULE§7)。
// master 鍵は env PEREGRINATIO_MASTER_KEY → 無ければ "peregrinatio:hostname:user" (マシン束縛)。
//
// 保存先は **絶対パス固定** (リポ直下 peregrinatio.config.json)。encrypted-config の既定は
// process.cwd() 基準なので、server(apps/server) と setup(リポ直下) で同一ファイルを指すよう
// PEREGRINATIO_CONFIG_PATH を合成して渡す。

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig, setConfig, deleteConfig, type StoreOptions, type ResolvedConfig } from '@ludiars/encrypted-config';

const _dir = dirname(fileURLToPath(import.meta.url)); // apps/server/src/secrets
const ROOT = resolve(_dir, '../../../..'); // リポジトリルート
const DEFAULT_CONFIG_PATH = resolve(ROOT, 'peregrinatio.config.json');

/** 暗号化して保存するキー。それ以外 (port 等) は plain。 */
export const SECRET_KEYS = new Set(['GOOGLE_MAPS_API_KEY']);

const STORE_OPTS: StoreOptions = {
  secretKeys: SECRET_KEYS,
  configPathEnv: 'PEREGRINATIO_CONFIG_PATH',
  masterKeyEnv: 'PEREGRINATIO_MASTER_KEY',
  defaultConfigFile: 'peregrinatio.config.json',
  masterSecretPrefix: 'peregrinatio',
};

/** cwd 非依存にするため config パスを絶対で固定した env を合成。 */
function env(): NodeJS.ProcessEnv {
  return { ...process.env, PEREGRINATIO_CONFIG_PATH: process.env.PEREGRINATIO_CONFIG_PATH ?? DEFAULT_CONFIG_PATH };
}

export function configPath(): string {
  return process.env.PEREGRINATIO_CONFIG_PATH ?? DEFAULT_CONFIG_PATH;
}

/** 全 config を平文 map で返す (シークレットは復号)。未存在なら null。 */
export function readLocalSecrets(): ResolvedConfig | null {
  return readConfig(STORE_OPTS, env());
}

/** 1 キーを保存 (SECRET_KEYS なら暗号化)。 */
export function setLocalConfig(key: string, value: string): void {
  setConfig(key, value, STORE_OPTS, env());
}

/** 1 キーを削除。 */
export function deleteLocalConfig(key: string): void {
  deleteConfig(key, STORE_OPTS, env());
}
