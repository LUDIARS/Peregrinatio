// リクエスト計測ミドルウェア。1 リクエストごとに method/path/status/所要時間を
// 構造化ログ (Vestigium JSONL) に書く。遅い API / 5xx / 例外を後から追える。
//
// SECURITY: ctx にはクエリ文字列・body・ヘッダ・PII を入れない。
//   c.req.path はクエリを含まないパスのみ ([[vestigium]] の ctx 機微情報禁止ルール)。

import type { Context, Next } from 'hono';
import { getLogWriter } from './vestigium.js';

/** 所要時間を測って JSONL に記録する Hono ミドルウェア。 */
export function requestLogger() {
  return async (c: Context, next: Next): Promise<void> => {
    const start = performance.now();
    let thrown: unknown = null;
    try {
      await next();
    } catch (err) {
      thrown = err;
      throw err; // 記録だけして再送出 (Hono の error 処理を邪魔しない)
    } finally {
      const writer = getLogWriter();
      if (writer) {
        const durationMs = Math.round((performance.now() - start) * 10) / 10;
        const status = thrown ? 500 : c.res.status;
        writer.write({
          level: thrown || status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
          channel: 'app',
          msg: `${c.req.method} ${c.req.path} ${status} ${durationMs}ms`,
          ctx: {
            method: c.req.method,
            path: c.req.path,
            status,
            duration_ms: durationMs,
            ...(thrown ? { error: errMessage(thrown) } : {}),
          },
        });
      }
    }
  };
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
