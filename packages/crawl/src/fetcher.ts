// robots.txt 遵守 + per-domain レート制限つきの礼節 fetcher (Tirocinium fetcher.ts 踏襲)。
// 取得不可は例外を投げず、理由つき FetchResult で返す (呼び出し側がエラー応答に変換)。

import { parseRobots, isAllowed, pathOf, type RobotsRules } from './robots.js';

export interface FetcherConfig {
  userAgent: string;
  fetchTimeoutMs: number;
  /** 同一ドメインへの最小間隔 (ms)。robots の Crawl-delay があれば長い方を採用。 */
  minIntervalMs: number;
  /** robots.txt を尊重するか (既定 true)。false でも礼節 UA / レート制限は維持。 */
  respectRobots: boolean;
}

export type FetchResult =
  | { ok: true; html: string; finalUrl: string }
  | { ok: false; reason: 'robots' | 'http' | 'timeout' | 'error'; message: string };

export class PoliteFetcher {
  private robots = new Map<string, RobotsRules | null>();
  private lastAt = new Map<string, number>();

  constructor(private readonly cfg: FetcherConfig) {}

  /** robots を考慮して取得。取得不可は理由つきで返す (例外を投げない)。 */
  async fetch(url: string): Promise<FetchResult> {
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      return { ok: false, reason: 'error', message: 'invalid url' };
    }

    if (this.cfg.respectRobots) {
      const rules = await this.robotsFor(url, host);
      if (rules && !isAllowed(rules, pathOf(url))) {
        return { ok: false, reason: 'robots', message: 'disallowed by robots.txt' };
      }
      await this.throttle(host, rules?.crawlDelay);
    } else {
      await this.throttle(host);
    }

    return this.rawFetch(url);
  }

  private async robotsFor(url: string, host: string): Promise<RobotsRules | null> {
    if (this.robots.has(host)) return this.robots.get(host)!;
    let rules: RobotsRules | null = null;
    try {
      const origin = new URL(url).origin;
      const res = await this.rawFetch(origin + '/robots.txt');
      if (res.ok) rules = parseRobots(res.html, this.cfg.userAgent);
    } catch {
      rules = null; // robots 取得失敗時は許可扱い (慣習)
    }
    this.robots.set(host, rules);
    return rules;
  }

  /** 同一ドメインへの連続アクセスを最小間隔まで待つ。 */
  private async throttle(host: string, crawlDelaySec?: number): Promise<void> {
    const interval = Math.max(this.cfg.minIntervalMs, (crawlDelaySec ?? 0) * 1000);
    const last = this.lastAt.get(host) ?? 0;
    const wait = last + interval - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastAt.set(host, Date.now());
  }

  private async rawFetch(url: string): Promise<FetchResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.fetchTimeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': this.cfg.userAgent, accept: 'text/html,*/*' },
        signal: ctrl.signal,
        redirect: 'follow',
      });
      if (!res.ok) return { ok: false, reason: 'http', message: `HTTP ${res.status}` };
      return { ok: true, html: await res.text(), finalUrl: res.url || url };
    } catch (err) {
      const e = err as { name?: string; message?: string };
      if (e.name === 'AbortError') return { ok: false, reason: 'timeout', message: 'timeout' };
      return { ok: false, reason: 'error', message: e.message ?? 'fetch error' };
    } finally {
      clearTimeout(timer);
    }
  }
}
