// Cloudflare Access の JWT (compact JWS) を分解し、RS256 署名を 1 つの JWK で確かめる。
// 依存なし (node:crypto)。Elegantia src/runtime/cf-jwt.ts と同じ方針: 中身は検証前に信用しない。
// @implements SPEC-CF-ACCESS-VERIFY

import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';

export interface JwtParts {
  header: { alg?: unknown; kid?: unknown };
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Buffer;
}

const SEGMENT = /^[A-Za-z0-9_-]+$/;

function decodeObject(value: string): Record<string, unknown> | undefined {
  const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
}

/** 3 区切りの base64url でなければ undefined。claims はまだ信用しない。 */
export function decodeJwt(token: string): JwtParts | undefined {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => !SEGMENT.test(p))) return undefined;
  try {
    const header = decodeObject(parts[0] as string);
    const payload = decodeObject(parts[1] as string);
    if (!header || !payload) return undefined;
    return {
      header,
      payload,
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: Buffer.from(parts[2] as string, 'base64url'),
    };
  } catch {
    // base64url / JSON として壊れたトークンは「不正なトークン」として扱う (例外にしない)。
    return undefined;
  }
}

/** RS256 の署名検証。alg 不一致・鍵の種類違い・壊れた鍵はすべて false (例外にしない)。 */
export function verifyRs256(parts: JwtParts, jwk: JsonWebKey): boolean {
  if (parts.header.alg !== 'RS256' || jwk.kty !== 'RSA') return false;
  try {
    return verify('RSA-SHA256', Buffer.from(parts.signingInput, 'utf8'), createPublicKey({ key: jwk, format: 'jwk' }), parts.signature);
  } catch {
    // 鍵の取り込みに失敗した JWK は検証不能 = 不一致として扱う。
    return false;
  }
}
