// `postgres` ライブラリ風のタグ付きテンプレート `sql` を node:sqlite (DatabaseSync) 上で
// 再実装した互換ドライバ (Tirocinium から流用)。await sql`...` / ネスト fragment /
// sql.json / sql.unsafe / sql.begin / sql.end / RETURNING / ON CONFLICT を動かす。

import { createRequire } from 'node:module';
import type * as NodeSqlite from 'node:sqlite';
import { randomUUID } from 'node:crypto';

// node:sqlite を static import すると vitest が experimental builtin を解決できないため
// 型は type-only、値は createRequire で runtime 解決する ([[feedback_vitest_node_sqlite_createrequire]])。
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof NodeSqlite;
type DatabaseSync = NodeSqlite.DatabaseSync;

class JsonParam {
  constructor(readonly value: unknown) {}
}

function toSqliteDialect(text: string): string {
  return text
    .replace(/\bnow\(\)/gi, "datetime('now')")
    .replace(/::\s*(text|int|integer|bigint|jsonb|json|uuid|smallint|real|boolean)\b/gi, '')
    .replace(/\bFOR\s+UPDATE\b/gi, '')
    .replace(/\$(\d+)/g, '?$1');
}

function encodeParam(v: unknown): string | number | bigint | null | Uint8Array {
  if (v === null || v === undefined) return null;
  if (v instanceof JsonParam) return JSON.stringify(v.value ?? null);
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'bigint') return v;
  if (v instanceof Uint8Array) return v;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v) || typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function decodeValue(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const t = v.trimStart();
  if (t === '' || (t[0] !== '[' && t[0] !== '{')) return v;
  try {
    const parsed = JSON.parse(v);
    return typeof parsed === 'object' ? parsed : v;
  } catch {
    return v;
  }
}

function decodeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(row)) out[k] = decodeValue(row[k]);
  return out;
}

type Built = { text: string; params: unknown[] };

class SqliteQuery {
  constructor(
    private readonly db: DatabaseSync,
    private readonly strings: readonly string[],
    private readonly values: readonly unknown[],
  ) {}

  build(): Built {
    let text = '';
    const params: unknown[] = [];
    for (let i = 0; i < this.strings.length; i++) {
      text += this.strings[i];
      if (i < this.values.length) {
        const v = this.values[i];
        if (v instanceof SqliteQuery) {
          const sub = v.build();
          text += sub.text;
          params.push(...sub.params);
        } else {
          text += '?';
          params.push(v);
        }
      }
    }
    return { text, params };
  }

  private exec(): unknown[] {
    const { text, params } = this.build();
    const sqlText = toSqliteDialect(text);
    const bound = params.map(encodeParam);
    const returnsRows = /^\s*(select|with|pragma)\b/i.test(sqlText) || /\breturning\b/i.test(sqlText);
    const stmt = this.db.prepare(sqlText);
    if (returnsRows) {
      return (stmt.all(...(bound as never[])) as Record<string, unknown>[]).map(decodeRow);
    }
    stmt.run(...(bound as never[]));
    return [];
  }

  then<T = unknown>(
    resolve: (rows: unknown[]) => T,
    reject?: (err: unknown) => unknown,
  ): T | undefined {
    try {
      return resolve(this.exec());
    } catch (err) {
      if (reject) return reject(err) as T;
      throw err;
    }
  }
  catch(reject: (err: unknown) => unknown): unknown {
    try {
      return Promise.resolve(this.exec());
    } catch (err) {
      return reject(err);
    }
  }
}

export type SqliteSql = (<T = unknown[]>(strings: TemplateStringsArray, ...values: unknown[]) => SqliteQuery & PromiseLike<T>) & {
  json(v: unknown): JsonParam;
  unsafe(text: string, params?: unknown[]): Promise<unknown[]>;
  begin<T>(fn: (tx: SqliteSql) => Promise<T>): Promise<T>;
  end(): Promise<void>;
};

export function createSqliteSql(path: string): SqliteSql {
  const db = new DatabaseSync(path);
  // synchronous=FULL: WAL でもコミット毎に fsync するため、プロセス強制終了や電源断でも
  // コミット済みデータは失われない (旅の内容を確実に永続化する)。
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;');
  db.function('uuid_generate_v4', { deterministic: false }, () => randomUUID());
  db.function('gen_random_uuid', { deterministic: false }, () => randomUUID());

  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) =>
    new SqliteQuery(db, strings, values)) as SqliteSql;

  sql.json = (v: unknown) => new JsonParam(v);

  sql.unsafe = async (text: string, params: unknown[] = []) => {
    const normalized = toSqliteDialect(text);
    if (params.length > 0 || /^\s*(select|with|pragma)\b/i.test(normalized) || /\breturning\b/i.test(normalized)) {
      const stmt = db.prepare(normalized);
      const bound = params.map(encodeParam);
      return (stmt.all(...(bound as never[])) as Record<string, unknown>[]).map(decodeRow);
    }
    db.exec(normalized);
    return [];
  };

  sql.begin = async <T>(fn: (tx: SqliteSql) => Promise<T>): Promise<T> => {
    db.exec('BEGIN');
    try {
      const result = await fn(sql);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };

  sql.end = async () => {
    // WAL チェックポイントは失敗してもクローズは続けるが、握りつぶさず必ずログする。
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); }
    catch (e) { console.error('[db] 終了時 WAL チェックポイントに失敗:', e); }
    db.close();
  };

  return sql;
}
