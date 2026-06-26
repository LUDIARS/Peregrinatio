// 統合テスト用の使い捨て SQLite。OS の一時ディレクトリに DB を作り、本番と同じ
// migration を適用する。テスト終了時に WAL をチェックポイントして close し、削除する。
// 実 DB (data/peregrinatio.sqlite) を絶対に触らないよう、毎テスト一意の temp パスを使う。

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config.js';
import { initSql, sql } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';

let dir: string | null = null;

/** 一時 DB を作り migration まで適用する (beforeAll で呼ぶ)。 */
export async function setupTestDb(): Promise<void> {
  dir = mkdtempSync(join(tmpdir(), 'peregrinatio-test-'));
  // 絶対パスなので sqlitePath() の resolve(PROJECT_ROOT, p) はそのまま p を返す。
  config.databaseUrl = join(dir, 'test.sqlite');
  initSql();
  await runMigrations();
}

/** 一時 DB を閉じて削除する (afterAll で呼ぶ)。 */
export async function teardownTestDb(): Promise<void> {
  await sql.end();
  if (dir) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    dir = null;
  }
}
