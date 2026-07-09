import { appendFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.js';

export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  channel: string;
  msg: string;
  ctx?: Record<string, unknown>;
}

export interface Writer {
  write(entry: LogEntry): void;
}

interface LogRuntime {
  writer: Writer;
  shutdown(): Promise<void>;
}

let instance: LogRuntime | null = null;
let restoreConsole: (() => void) | null = null;

export function initVestigium(): LogRuntime | null {
  if (instance) return instance;
  if (!config.logging.enabled) return null;

  const writer = createJsonlWriter();
  instance = {
    writer,
    async shutdown() {
      restoreConsole?.();
      restoreConsole = null;
      await writer.flush();
    },
  };

  if (config.logging.captureConsole) {
    restoreConsole = installConsoleCapture(writer);
  }
  void pruneOldLogs();
  return instance;
}

export function getLogWriter(): Writer | null {
  return instance?.writer ?? null;
}

export async function shutdownVestigium(): Promise<void> {
  if (!instance) return;
  const current = instance;
  instance = null;
  await current.shutdown();
}

function createJsonlWriter(): Writer & { flush(): Promise<void> } {
  let queue = Promise.resolve();
  const dir = join(config.logging.logsDir, config.logging.serviceCode);

  const writer = {
    write(entry: LogEntry): void {
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        service: config.logging.serviceCode,
        ...entry,
      }) + '\n';
      queue = queue
        .then(async () => {
          await mkdir(dir, { recursive: true });
          await appendFile(join(dir, `${todayUtc()}.jsonl`), line, 'utf8');
        })
        .catch(() => undefined);
    },
    async flush(): Promise<void> {
      await queue;
    },
  };
  return writer;
}

function installConsoleCapture(writer: Writer): () => void {
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  console.log = (...args: unknown[]) => {
    original.log(...args);
    writer.write({ level: 'info', channel: 'console', msg: formatConsole(args) });
  };
  console.info = (...args: unknown[]) => {
    original.info(...args);
    writer.write({ level: 'info', channel: 'console', msg: formatConsole(args) });
  };
  console.warn = (...args: unknown[]) => {
    original.warn(...args);
    writer.write({ level: 'warn', channel: 'console', msg: formatConsole(args) });
  };
  console.error = (...args: unknown[]) => {
    original.error(...args);
    writer.write({ level: 'error', channel: 'console', msg: formatConsole(args) });
  };
  return () => {
    console.log = original.log;
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
  };
}

function formatConsole(args: unknown[]): string {
  return args.map((arg) => {
    if (arg instanceof Error) return arg.stack ?? arg.message;
    if (typeof arg === 'string') return arg;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }).join(' ');
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function pruneOldLogs(): Promise<void> {
  const cutoff = Date.now() - config.logging.retentionDays * 24 * 60 * 60 * 1000;
  const dir = join(config.logging.logsDir, config.logging.serviceCode);
  try {
    const files = await readdir(dir);
    await Promise.all(files
      .filter((name) => name.endsWith('.jsonl'))
      .map(async (name) => {
        const path = join(dir, name);
        const meta = await stat(path);
        if (meta.mtimeMs < cutoff) await rm(path, { force: true });
      }));
  } catch {
    // Missing log directories or retention cleanup failures must not block startup.
  }
}
