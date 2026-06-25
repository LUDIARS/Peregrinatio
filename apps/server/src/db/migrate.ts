import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hydrateSecrets } from '../config.js';
import { sql, initSql } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function ensureMigrationsTable() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS _peregrinatio_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

async function appliedSet(): Promise<Set<string>> {
  const rows = (await sql`SELECT name FROM _peregrinatio_migrations`) as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

export async function runMigrations(): Promise<number> {
  const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations-sqlite');
  await ensureMigrationsTable();
  const applied = await appliedSet();
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const text = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`applying ${file}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`INSERT INTO _peregrinatio_migrations (name) VALUES (${file})`;
    });
    count++;
  }
  return count;
}

async function main() {
  await hydrateSecrets();
  initSql();
  const count = await runMigrations();
  console.log(`done. ${count} migration(s) applied.`);
  await sql.end();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
