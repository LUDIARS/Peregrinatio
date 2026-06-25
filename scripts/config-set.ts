// ローカル暗号化 config に 1 キーを登録する CLI。
//   npm run config-set GOOGLE_MAPS_API_KEY AIza...         # 値を直接指定
//   npm run config-set GOOGLE_MAPS_API_KEY @path/to/file   # ファイル内容を値に (鍵をシェル履歴/ログに残さない)
// SECRET_KEYS のキーは AES-256-GCM で暗号化保存、それ以外は平文。保存先は peregrinatio.config.json。
import { readFileSync } from 'node:fs';
import { setLocalConfig, configPath, SECRET_KEYS } from '../apps/server/src/secrets/store.js';

const [key, raw] = process.argv.slice(2);
if (!key || raw === undefined) {
  console.error('usage: npm run config-set <KEY> <value | @file>');
  process.exit(1);
}
const value = (raw.startsWith('@') ? readFileSync(raw.slice(1), 'utf8') : raw).trim();
if (!value) {
  console.error('value is empty');
  process.exit(1);
}
setLocalConfig(key, value);
console.log(`stored ${key} ${SECRET_KEYS.has(key) ? '(暗号化)' : '(平文)'} len=${value.length} -> ${configPath()}`);
