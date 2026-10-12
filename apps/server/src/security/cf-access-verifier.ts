// Cloudflare Access のアプリトークン (Cf-Access-Jwt-Assertion) を、チームの公開鍵 (JWKS) で検証する。
//   - JWKS は https://<team>/cdn-cgi/access/certs を 10 分キャッシュし、kid が見つからないときだけ取り直す
//     (取り直しは 1 分に 1 回まで。偽 kid の連打で JWKS を叩かせない)。
//   - claims: aud に AUD タグを含む / exp が未来 / nbf が過去 (あれば) / iss = teamDomain。
// 失敗は理由コードで返す (403 の本文に載せる。トークンの中身や鍵は載せない)。
// @implements SPEC-CF-ACCESS-VERIFY

import type { JsonWebKey } from 'node:crypto';
import type { CfAccessConfig } from './cf-access-config.js';
import { decodeJwt, verifyRs256 } from './cf-jwt.js';

export type JwksFetcher = (url: string) => Promise<unknown>;

export type CfAccessFailure =
  | 'missing_assertion'
  | 'malformed_token'
  | 'unsupported_alg'
  | 'unknown_kid'
  | 'bad_signature'
  | 'bad_issuer'
  | 'bad_audience'
  | 'expired'
  | 'not_yet_valid';

export type CfAccessResult = { ok: true; email: string | null } | { ok: false; reason: CfAccessFailure };

export const JWKS_TTL_MS = 10 * 60 * 1000;
const UNKNOWN_KID_RETRY_MS = 60 * 1000;
const MAX_ASSERTION_LENGTH = 8192;

async function fetchJwksDefault(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`JWKS の取得に失敗しました (HTTP ${res.status})`);
  return res.json();
}

function claimsFailure(payload: Record<string, unknown>, config: CfAccessConfig, nowMs: number): CfAccessFailure | null {
  const now = Math.floor(nowMs / 1000);
  if (payload.iss !== config.teamDomain) return 'bad_issuer';
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(config.audience)) return 'bad_audience';
  if (typeof payload.exp !== 'number' || payload.exp <= now) return 'expired';
  if (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || payload.nbf > now)) return 'not_yet_valid';
  return null;
}

export class CfAccessVerifier {
  private readonly keys = new Map<string, JsonWebKey>();
  private fetchedAt = -Infinity;
  private inflight: Promise<void> | undefined;

  constructor(
    readonly config: CfAccessConfig,
    private readonly fetchJwks: JwksFetcher = fetchJwksDefault,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async verify(assertion: string | undefined): Promise<CfAccessResult> {
    if (!assertion) return { ok: false, reason: 'missing_assertion' };
    if (assertion.length > MAX_ASSERTION_LENGTH) return { ok: false, reason: 'malformed_token' };
    const parts = decodeJwt(assertion);
    if (!parts || typeof parts.header.kid !== 'string') return { ok: false, reason: 'malformed_token' };
    if (parts.header.alg !== 'RS256') return { ok: false, reason: 'unsupported_alg' };
    const key = await this.keyFor(parts.header.kid);
    if (!key) return { ok: false, reason: 'unknown_kid' };
    if (!verifyRs256(parts, key)) return { ok: false, reason: 'bad_signature' };
    const failure = claimsFailure(parts.payload, this.config, this.now());
    if (failure) return { ok: false, reason: failure };
    return { ok: true, email: typeof parts.payload.email === 'string' ? parts.payload.email : null };
  }

  private async keyFor(kid: string): Promise<JsonWebKey | undefined> {
    if (this.keys.size === 0 || this.now() - this.fetchedAt > JWKS_TTL_MS) await this.refresh();
    if (!this.keys.has(kid) && this.now() - this.fetchedAt > UNKNOWN_KID_RETRY_MS) await this.refresh();
    return this.keys.get(kid);
  }

  private refresh(): Promise<void> {
    this.inflight ??= this.load().finally(() => { this.inflight = undefined; });
    return this.inflight;
  }

  private async load(): Promise<void> {
    let body: unknown;
    try {
      body = await this.fetchJwks(`${this.config.teamDomain}/cdn-cgi/access/certs`);
    } catch (e) {
      // 取得失敗は手持ちの鍵で検証を続ける (無ければ unknown_kid で 403 = 閉じる側に倒れる)。
      console.warn('[security] Cloudflare Access の JWKS 取得に失敗:', e instanceof Error ? e.message : e);
      this.fetchedAt = this.now();
      return;
    }
    const keys = typeof body === 'object' && body !== null && Array.isArray((body as { keys?: unknown }).keys)
      ? (body as { keys: unknown[] }).keys
      : [];
    this.keys.clear();
    for (const key of keys) {
      if (typeof key !== 'object' || key === null) continue;
      const jwk = key as JsonWebKey & { kid?: unknown };
      if (typeof jwk.kid === 'string' && jwk.kty === 'RSA') this.keys.set(jwk.kid, jwk);
    }
    this.fetchedAt = this.now();
  }
}
