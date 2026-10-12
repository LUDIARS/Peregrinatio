import { createSign, generateKeyPairSync, type JsonWebKey } from 'node:crypto';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { cfAccessConfigFromEnv, RUNTIME_CONFIG_ENV } from './cf-access-config.js';
import { cfAccessMiddleware } from './cf-access-middleware.js';
import { CfAccessVerifier, JWKS_TTL_MS } from './cf-access-verifier.js';
import { isLoopbackAddress, isLoopbackRequest } from './request-origin.js';

const TEAM = 'https://ludiars.cloudflareaccess.com';
const AUD = 'a'.repeat(64);
const NOW = Date.parse('2026-10-13T00:00:00Z');
const nowSec = Math.floor(NOW / 1000);

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = (key = publicKey, kid = 'k1'): JsonWebKey => ({ ...key.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' });

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function token(payload: Record<string, unknown> = {}, header: Record<string, unknown> = {}, key = privateKey): string {
  const head = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT', ...header });
  const body = b64({ iss: TEAM, aud: [AUD], exp: nowSec + 600, nbf: nowSec - 10, email: 'me@example.com', ...payload });
  const signer = createSign('RSA-SHA256');
  signer.update(`${head}.${body}`);
  return `${head}.${body}.${signer.sign(key).toString('base64url')}`;
}

function verifier(fetcher = vi.fn(async () => ({ keys: [jwk()] })), now = () => NOW) {
  return { v: new CfAccessVerifier({ teamDomain: TEAM, audience: AUD }, fetcher, now), fetcher };
}

describe('CfAccessVerifier', () => {
  it('正しいトークンを通す', async () => {
    expect(await verifier().v.verify(token())).toEqual({ ok: true, email: 'me@example.com' });
  });

  it.each([
    ['aud 不一致', token({ aud: ['b'.repeat(64)] }), 'bad_audience'],
    ['exp 切れ', token({ exp: nowSec - 1 }), 'expired'],
    ['nbf が未来', token({ nbf: nowSec + 600 }), 'not_yet_valid'],
    ['iss 不一致', token({ iss: 'https://evil.cloudflareaccess.com' }), 'bad_issuer'],
    ['kid 不明', token({}, { kid: 'nope' }), 'unknown_kid'],
    ['alg=HS256', token({}, { alg: 'HS256' }), 'unsupported_alg'],
    ['alg=none', token({}, { alg: 'none' }), 'unsupported_alg'],
    ['別の鍵で署名', token({}, {}, other.privateKey), 'bad_signature'],
    ['壊れたトークン', 'abc.def', 'malformed_token'],
  ])('%s は拒否する', async (_label, assertion, reason) => {
    expect(await verifier().v.verify(assertion)).toEqual({ ok: false, reason });
  });

  it('本文の改ざんは署名で弾く', async () => {
    const [h, , s] = token().split('.');
    const forged = `${h}.${b64({ iss: TEAM, aud: [AUD], exp: nowSec + 9999 })}.${s}`;
    expect(await verifier().v.verify(forged)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('ヘッダが無ければ missing_assertion', async () => {
    expect(await verifier().v.verify(undefined)).toEqual({ ok: false, reason: 'missing_assertion' });
  });

  it('JWKS は 10 分キャッシュし、kid 不一致のときだけ取り直す', async () => {
    let t = NOW;
    const keys = [jwk()];
    const fetcher = vi.fn(async () => ({ keys }));
    const { v } = verifier(fetcher, () => t);
    await v.verify(token());
    await v.verify(token());
    expect(fetcher).toHaveBeenCalledTimes(1);

    // 鍵のローテーション: 新しい kid は 1 分以上たっていれば取り直して通る。
    keys.push(jwk(other.publicKey, 'k2'));
    t += 61_000;
    expect((await v.verify(token({}, { kid: 'k2' }, other.privateKey))).ok).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);

    t += JWKS_TTL_MS + 1;
    await v.verify(token());
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('JWKS の取得に失敗したら閉じる側 (unknown_kid) に倒れる', async () => {
    const { v } = verifier(vi.fn(async () => { throw new Error('down'); }));
    expect(await v.verify(token())).toEqual({ ok: false, reason: 'unknown_kid' });
  });
});

describe('cfAccessConfigFromEnv', () => {
  const env = (o: unknown) => ({ [RUNTIME_CONFIG_ENV]: JSON.stringify(o) });

  it('runtime-config が無い・cloudflareAccess が無いときは無効 (undefined)', () => {
    expect(cfAccessConfigFromEnv({})).toBeUndefined();
    expect(cfAccessConfigFromEnv(env({ other: 1 }))).toBeUndefined();
  });

  it('teamDomain を origin に正規化する', () => {
    expect(cfAccessConfigFromEnv(env({ cloudflareAccess: { teamDomain: 'ludiars.cloudflareaccess.com', audience: AUD } })))
      .toEqual({ teamDomain: TEAM, audience: AUD });
  });

  it('片方だけ・不正値は起動時に throw する', () => {
    expect(() => cfAccessConfigFromEnv(env({ cloudflareAccess: { teamDomain: TEAM } }))).toThrow();
    expect(() => cfAccessConfigFromEnv(env({ cloudflareAccess: { teamDomain: TEAM, audience: 'xyz' } }))).toThrow();
    expect(() => cfAccessConfigFromEnv(env({ cloudflareAccess: { teamDomain: 'http://x.com', audience: AUD } }))).toThrow();
    expect(() => cfAccessConfigFromEnv({ [RUNTIME_CONFIG_ENV]: 'not json' })).toThrow();
  });
});

describe('ループバック判定', () => {
  const req = (remoteAddress: string | null, host: string, headers: Record<string, string> = {}) => ({
    remoteAddress, host, header: (n: string) => headers[n],
  });

  it('送信元・Host がループバックで CF ヘッダが無いときだけループバック', () => {
    expect(isLoopbackRequest(req('127.0.0.1', '127.0.0.1:8090'))).toBe(true);
    expect(isLoopbackRequest(req('::ffff:127.0.0.1', 'localhost:8090'))).toBe(true);
    expect(isLoopbackRequest(req('::1', '[::1]:8090'))).toBe(true);
    // Tunnel 経由: cloudflared はローカルから繋ぐが Host は公開ホスト名。
    expect(isLoopbackRequest(req('127.0.0.1', 'pe.ai-run-do.com'))).toBe(false);
    expect(isLoopbackRequest(req('127.0.0.1', '127.0.0.1:8090', { 'cf-connecting-ip': '1.2.3.4' }))).toBe(false);
    expect(isLoopbackRequest(req('192.168.1.5', '127.0.0.1:8090'))).toBe(false);
    expect(isLoopbackRequest(req(null, '127.0.0.1:8090'))).toBe(false);
  });

  it('isLoopbackAddress', () => {
    expect(isLoopbackAddress('127.10.0.1')).toBe(true);
    expect(isLoopbackAddress('10.0.0.1')).toBe(false);
  });
});

describe('cfAccessMiddleware', () => {
  function app() {
    const a = new Hono();
    a.use('*', cfAccessMiddleware(verifier().v));
    a.get('*', (c) => c.text('ok'));
    return a;
  }
  const local = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };

  it('ループバックは検証なしで通す', async () => {
    const res = await app().request('http://127.0.0.1:8090/healthz', {}, local);
    expect(res.status).toBe(200);
  });

  it('公開ホスト名で来た要求は JWT 必須 (共有リンクも例外にしない)', async () => {
    const res = await app().request('http://pe.ai-run-do.com/s/abc', { headers: { host: 'pe.ai-run-do.com' } }, local);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'missing_assertion' });
    const ok = await app().request('http://pe.ai-run-do.com/s/abc', {
      headers: { host: 'pe.ai-run-do.com', 'cf-access-jwt-assertion': token() },
    }, local);
    expect(ok.status).toBe(200);
  });

  it('CF ヘッダ付きは Host がループバックでも検証する', async () => {
    const res = await app().request('http://127.0.0.1:8090/api/trips', {
      headers: { 'cf-ray': 'x', 'cf-access-jwt-assertion': token({ exp: nowSec - 1 }) },
    }, local);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'expired' });
  });
});
