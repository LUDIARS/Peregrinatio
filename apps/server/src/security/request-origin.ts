// 要求がループバック (この PC の中) から来たかの判定 (純関数)。
// サーバは 127.0.0.1 にしか bind せず、cloudflared (Tunnel) もローカルから繋いでくるため、
// ソケットの送信元だけでは Tunnel 経由と区別できない。そこで次の 3 つがそろったときだけループバックとみなす:
//   1. ソケットの送信元がループバック (127.0.0.0/8, ::1, ::ffff:127.x)
//   2. Host ヘッダがループバックのホスト名 (127.0.0.1 / localhost / [::1]、ポート任意)
//   3. Cloudflare のエッジが付けるヘッダ (cf-connecting-ip / cf-ray / cf-access-jwt-assertion) が無い
// Tunnel 経由の要求は公開ホスト名の Host と cf-* ヘッダを持つので、必ず JWT 検証に回る。
// @implements SPEC-CF-ACCESS-LOOPBACK

const CF_EDGE_HEADERS = ['cf-connecting-ip', 'cf-ray', 'cf-access-jwt-assertion'] as const;

export function isLoopbackAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  const a = address.toLowerCase();
  if (a === '::1') return true;
  const v4 = a.startsWith('::ffff:') ? a.slice(7) : a;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

/** 'host:port' / '[::1]:port' からホスト名だけを取り出す。 */
function hostName(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.split(':')[0] ?? '';
}

export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const name = hostName(host);
  return name === 'localhost' || name === '[::1]' || isLoopbackAddress(name);
}

export interface RequestOrigin {
  remoteAddress: string | null;
  host: string | null;
  header(name: string): string | null | undefined;
}

export function isLoopbackRequest(req: RequestOrigin): boolean {
  if (!isLoopbackAddress(req.remoteAddress) || !isLoopbackHost(req.host)) return false;
  return CF_EDGE_HEADERS.every((name) => !req.header(name));
}
