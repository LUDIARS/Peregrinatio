// DB 接続。Step1 は SQLite (node:sqlite) 既定。共有時は Tirocinium 同様 postgres を
// 足して databaseUrl で切替えられるようにする (DESIGN.md §2)。
import { resolve, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config, PROJECT_ROOT } from '../config.js';
import { createSqliteSql, type SqliteSql } from './sqlite-driver.js';

let _impl: SqliteSql | null = null;

function sqlitePath(u: string): string {
  if (!u) return resolve(PROJECT_ROOT, 'data', 'peregrinatio.sqlite');
  const p = u
    .replace(/^sqlite:\/\//, '')
    .replace(/^sqlite:/, '')
    .replace(/^file:\/\//, '')
    .replace(/^file:/, '');
  return resolve(PROJECT_ROOT, p);
}

/** hydrateSecrets() の後に呼ぶ。 */
export function initSql(): void {
  const path = sqlitePath(config.databaseUrl);
  mkdirSync(dirname(path), { recursive: true });
  _impl = createSqliteSql(path);
}

function getImpl(): SqliteSql {
  if (!_impl) throw new Error('DB not initialized — call initSql() after hydrateSecrets()');
  return _impl;
}

// 遅延ラッパー。route コードは `await sql\`...\`` で使う。
const sqlWrapper = ((...args: unknown[]) => (getImpl() as unknown as (...a: unknown[]) => unknown)(...args)) as unknown as SqliteSql;
sqlWrapper.json = (v: unknown) => getImpl().json(v);
sqlWrapper.unsafe = (text: string, params?: unknown[]) => getImpl().unsafe(text, params);
sqlWrapper.begin = (<T>(fn: (tx: SqliteSql) => Promise<T>) => getImpl().begin(fn)) as SqliteSql['begin'];
sqlWrapper.end = () => getImpl().end();

export const sql: SqliteSql = sqlWrapper;
