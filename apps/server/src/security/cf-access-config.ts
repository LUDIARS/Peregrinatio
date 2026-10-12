// Cloudflare Access 検証の設定を Excubitor の runtime-config から読む。
// Excubitor は env EXCUBITOR_SERVICE_CONFIG_JSON (JSON オブジェクト文字列) で注入する。
//   { "cloudflareAccess": { "teamDomain": "https://<team>.cloudflareaccess.com", "audience": "<AUD tag>" } }
// cloudflareAccess が無ければ検証しない (直接アクセス・開発用)。片方だけ・不正値は起動時に throw する
// (半端な設定で黙って鍵なしにならないように)。
// @implements SPEC-CF-ACCESS-CONFIG

export const RUNTIME_CONFIG_ENV = 'EXCUBITOR_SERVICE_CONFIG_JSON';

export interface CfAccessConfig {
  /** 'https://<team>.cloudflareaccess.com' (末尾スラッシュなしの origin)。iss と一致する。 */
  teamDomain: string;
  /** Access アプリの AUD タグ。 */
  audience: string;
}

const AUDIENCE_TAG = /^[a-f0-9]{32,128}$/i;

function normalizeTeamDomain(raw: string): string {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try { url = new URL(withScheme); } catch { throw new Error('cloudflareAccess.teamDomain が URL として読めません'); }
  if (url.protocol !== 'https:' || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw new Error('cloudflareAccess.teamDomain は https://<team>.cloudflareaccess.com の形で指定してください');
  }
  return url.origin;
}

/** env から読む。未設定なら undefined、壊れていれば throw。 */
export function cfAccessConfigFromEnv(env: NodeJS.ProcessEnv): CfAccessConfig | undefined {
  const raw = env[RUNTIME_CONFIG_ENV];
  if (raw === undefined || raw.trim() === '') return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error(`${RUNTIME_CONFIG_ENV} が JSON として読めません`); }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${RUNTIME_CONFIG_ENV} は JSON オブジェクトである必要があります`);
  }
  const section = (parsed as Record<string, unknown>).cloudflareAccess;
  if (section === undefined || section === null) return undefined;
  if (typeof section !== 'object' || Array.isArray(section)) throw new Error('cloudflareAccess はオブジェクトで指定してください');

  const s = section as Record<string, unknown>;
  const teamDomain = typeof s.teamDomain === 'string' ? s.teamDomain.trim() : '';
  const audience = typeof s.audience === 'string' ? s.audience.trim() : '';
  if (!teamDomain && !audience) return undefined;
  if (!teamDomain || !audience) throw new Error('cloudflareAccess.teamDomain と audience は両方そろえて設定してください');
  if (!AUDIENCE_TAG.test(audience)) throw new Error('cloudflareAccess.audience が AUD タグの形 (16 進) ではありません');
  return { teamDomain: normalizeTeamDomain(teamDomain), audience };
}
