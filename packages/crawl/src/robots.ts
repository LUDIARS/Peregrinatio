// 最小の robots.txt パーサ / 許可判定 (純関数)。
// 任意サイト 1 ページ取得が対象なので、必要十分な User-agent グループ + Allow/Disallow +
// Crawl-delay のみを扱う。複雑なワイルドカード ($, *) も簡易対応する。

export interface RobotsRules {
  /** Allow パターン (前方一致 + * / $)。 */
  allow: string[];
  /** Disallow パターン。 */
  disallow: string[];
  /** Crawl-delay 秒 (あれば)。 */
  crawlDelay?: number;
}

/** URL からパス + クエリ部分を取り出す (robots 判定用)。 */
export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return '/';
  }
}

/**
 * robots.txt を parse し、指定 UA に適用されるグループを返す。
 * UA は前方一致 (小文字) で照合し、無ければ '*' グループを使う。
 */
export function parseRobots(text: string, userAgent: string): RobotsRules {
  const uaToken = userAgent.toLowerCase().split('/')[0]!.trim();
  const lines = text.split(/\r?\n/);

  // UA → rules の中間表現
  const groups = new Map<string, RobotsRules>();
  let currentAgents: string[] = [];
  let lastWasAgent = false;

  const ensure = (ua: string): RobotsRules => {
    let g = groups.get(ua);
    if (!g) {
      g = { allow: [], disallow: [] };
      groups.set(ua, g);
    }
    return g;
  };

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      if (!lastWasAgent) currentAgents = [];
      currentAgents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (currentAgents.length === 0) continue;

    for (const ua of currentAgents) {
      const g = ensure(ua);
      if (field === 'disallow') g.disallow.push(value);
      else if (field === 'allow') g.allow.push(value);
      else if (field === 'crawl-delay') {
        const n = Number(value);
        if (!Number.isNaN(n)) g.crawlDelay = n;
      }
    }
  }

  // 最適マッチ: 完全一致 UA トークンに前方一致するもの > '*'
  let chosen: RobotsRules | undefined;
  for (const [ua, g] of groups) {
    if (ua !== '*' && uaToken.startsWith(ua)) {
      chosen = g;
      break;
    }
  }
  if (!chosen) chosen = groups.get('*');
  return chosen ?? { allow: [], disallow: [] };
}

/** robots パターンを正規表現に変換 (* = 任意, $ = 終端)。 */
function patternToRegExp(pattern: string): RegExp {
  // 末尾 $ の扱い
  const anchoredEnd = pattern.endsWith('$');
  const body = anchoredEnd ? pattern.slice(0, -1) : pattern;
  const escaped = body
    .split('*')
    .map((seg) => seg.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + escaped + (anchoredEnd ? '$' : ''));
}

/**
 * path がこの rules で許可されているか。
 * 最長マッチ優先 (REP 慣習): Allow と Disallow で最も長いパターンが勝つ。
 */
export function isAllowed(rules: RobotsRules, path: string): boolean {
  const match = (patterns: string[]): number => {
    let best = -1;
    for (const p of patterns) {
      if (p === '') continue;
      if (patternToRegExp(p).test(path)) best = Math.max(best, p.length);
    }
    return best;
  };
  const allowLen = match(rules.allow);
  const disallowLen = match(rules.disallow);
  if (disallowLen === -1) return true;
  // Allow が同等以上に長ければ許可 (タイは Allow 勝ち)
  return allowLen >= disallowLen;
}
