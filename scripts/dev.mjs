// Peregrinatio dev ランチャー (Windows 向け、Tirocinium/scripts/dev.mjs を簡略化)。
//   - 起動前に DEV_PORTS を掃除して EADDRINUSE を防ぐ
//   - migrate を一度だけ走らせる (SQLite 既定 / Docker 不要)
//   - server / web をサブプロセスで起動し [server]/[web] プレフィクスで出力
//   - 親終了時に taskkill /F /T でプロセスツリーごと kill

import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SERVER_PORT = 8090;
const WEB_PORT = 5179;
const DEV_PORTS = [SERVER_PORT, WEB_PORT];

function killPort(port) {
  try {
    const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
    for (const line of out.split('\n')) {
      if (!line.includes(`:${port} `) && !line.includes(`:${port}\t`)) continue;
      const procId = line.trim().split(/\s+/).at(-1);
      if (!procId || !/^\d+$/.test(procId) || procId === '0') continue;
      try {
        execFileSync('taskkill', ['/F', '/T', '/PID', procId], { stdio: 'ignore' });
        console.log(`[dev] killed stale PID ${procId} on port ${port}`);
      } catch { /* already gone */ }
    }
  } catch { /* netstat unavailable */ }
}

console.log('[dev] cleaning up stale port bindings...');
for (const p of DEV_PORTS) killPort(p);

function runOnce(label, args) {
  console.log(`[dev] ${label}...`);
  const r = spawnSync('npm', args, { cwd: ROOT, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error(`[dev] ${label} failed (exit ${r.status}) — aborting`);
    process.exit(r.status ?? 1);
  }
}

runOnce('migrate', ['run', 'migrate']);

const ANSI = { blue: '\x1b[34m', magenta: '\x1b[35m', reset: '\x1b[0m' };

function spawnPrefixed(label, color, args) {
  const pre = `${ANSI[color]}[${label}]${ANSI.reset} `;
  const child = spawn('npm', args, {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    windowsHide: true,
  });
  child.stdout.on('data', (d) => process.stdout.write(d.toString().replace(/^(?=.)/gm, pre)));
  child.stderr.on('data', (d) => process.stderr.write(d.toString().replace(/^(?=.)/gm, pre)));
  child.on('exit', (code, sig) => console.log(`${pre}exited (code=${code ?? sig})`));
  return child;
}

console.log('[dev] starting server + web...');
console.log(`[dev]   server: http://localhost:${SERVER_PORT}`);
console.log(`[dev]   web   : http://localhost:${WEB_PORT}`);

const server = spawnPrefixed('server', 'blue', ['run', 'dev:server']);
const web = spawnPrefixed('web', 'magenta', ['run', 'dev:web']);

function killAll(label) {
  console.log(`\n[dev] ${label} — killing process trees...`);
  for (const c of [server, web]) {
    if (c.pid == null) continue;
    try {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(c.pid)], { stdio: 'ignore' });
    } catch { /* already dead */ }
  }
}

process.on('SIGINT', () => { killAll('SIGINT'); process.exit(0); });
process.on('SIGTERM', () => { killAll('SIGTERM'); process.exit(0); });
process.on('exit', () => killAll('exit'));
