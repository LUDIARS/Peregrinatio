// Cloudflare Access の多重防御ミドルウェア。エッジで JWT 必須にしていても、アプリ側でも確かめる。
// ループバック (Ex Viewer・ヘルスチェック・ローカル開発) は通し、それ以外は Cf-Access-Jwt-Assertion を検証する。
// 共有リンク (/s/:token) も鍵の内側 (例外パスは設けない)。失敗は 403 で本文は理由コードのみ。
// Cf-Access-Authenticated-User-Email は署名されていないので使わない。
// @implements SPEC-CF-ACCESS-VERIFY
// @implements SPEC-CF-ACCESS-LOOPBACK

import type { MiddlewareHandler } from 'hono';
import type { CfAccessVerifier } from './cf-access-verifier.js';
import { isLoopbackRequest } from './request-origin.js';

interface NodeBindings {
  incoming?: { socket?: { remoteAddress?: string } };
}

export function cfAccessMiddleware(verifier: CfAccessVerifier): MiddlewareHandler {
  return async (c, next) => {
    const env = c.env as NodeBindings | undefined;
    const loopback = isLoopbackRequest({
      remoteAddress: env?.incoming?.socket?.remoteAddress ?? null,
      // Host ヘッダが無い要求 (HTTP/1.0 等) は、node-server が組み立てた URL のホストで判定する。
      host: c.req.header('host') ?? new URL(c.req.url).host,
      header: (name) => c.req.header(name),
    });
    if (loopback) return next();

    const result = await verifier.verify(c.req.header('cf-access-jwt-assertion'));
    if (!result.ok) return c.json({ error: result.reason }, 403);
    return next();
  };
}
