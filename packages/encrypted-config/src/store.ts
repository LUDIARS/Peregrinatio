import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hostname, userInfo } from 'node:os';
import { encryptJson, decryptJson, isEncryptedBlob, type EncryptedBlob } from './crypto.js';

export type { EncryptedBlob };

export interface ConfigFile {
  plain: Record<string, string>;
  secrets: Record<string, EncryptedBlob>;
}

export type ResolvedConfig = Record<string, string>;

export interface StoreOptions {
  secretKeys: Set<string>;
  configPathEnv: string;
  masterKeyEnv: string;
  defaultConfigFile: string;
  masterSecretPrefix: string;
}

const UNSAFE_CONFIG_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function assertSafeConfigKey(key: string): void {
  if (UNSAFE_CONFIG_KEYS.has(key)) {
    throw new Error(`Unsupported config key: ${key}`);
  }
}

function readPlainValues(value: unknown, path: string): Record<string, string> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid plain config in ${path}`);
  }

  const plain: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    assertSafeConfigKey(key);
    if (typeof entry !== 'string') throw new Error(`Invalid plain config value for ${key} in ${path}`);
    plain[key] = entry;
  }
  return plain;
}

function readSecretBlobs(value: unknown, path: string): Record<string, EncryptedBlob> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid encrypted config in ${path}`);
  }

  const secrets: Record<string, EncryptedBlob> = {};
  for (const [key, blob] of Object.entries(value)) {
    assertSafeConfigKey(key);
    secrets[key] = blob as EncryptedBlob;
  }
  return secrets;
}

export function resolveConfigPath(opts: StoreOptions, env: NodeJS.ProcessEnv = process.env): string {
  const override = env[opts.configPathEnv];
  if (override && override.length > 0) return override;
  return join(process.cwd(), opts.defaultConfigFile);
}

export function resolveMasterSecret(opts: StoreOptions, env: NodeJS.ProcessEnv = process.env): string {
  const override = env[opts.masterKeyEnv];
  if (override && override.length > 0) return override;
  return `${opts.masterSecretPrefix}:${hostname()}:${userInfo().username}`;
}

export function readConfigFile(opts: StoreOptions, env: NodeJS.ProcessEnv = process.env): ConfigFile {
  const path = resolveConfigPath(opts, env);
  if (!existsSync(path)) return { plain: {}, secrets: {} };
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid config file: ${path}`);
  }
  const config = parsed as Partial<ConfigFile>;
  return {
    plain: readPlainValues(config.plain, path),
    secrets: readSecretBlobs(config.secrets, path),
  };
}

export function writeConfigFile(cfg: ConfigFile, opts: StoreOptions, env: NodeJS.ProcessEnv = process.env): void {
  const path = resolveConfigPath(opts, env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
}

export function readConfig(opts: StoreOptions, env: NodeJS.ProcessEnv = process.env): ResolvedConfig | null {
  if (!existsSync(resolveConfigPath(opts, env))) return null;
  const cfg = readConfigFile(opts, env);
  const masterSecret = resolveMasterSecret(opts, env);
  const out: ResolvedConfig = { ...cfg.plain };
  for (const [key, blob] of Object.entries(cfg.secrets)) {
    if (!isEncryptedBlob(blob)) continue;
    try {
      out[key] = decryptJson<string>(blob, masterSecret);
    } catch {
      // A changed key or tampered ciphertext must not expose a value.
    }
  }
  return out;
}

export function setConfig(key: string, value: string, opts: StoreOptions, env: NodeJS.ProcessEnv = process.env): void {
  assertSafeConfigKey(key);
  const cfg = readConfigFile(opts, env);
  if (opts.secretKeys.has(key)) {
    cfg.secrets[key] = encryptJson(value, resolveMasterSecret(opts, env));
    delete cfg.plain[key];
  } else {
    cfg.plain[key] = value;
    delete cfg.secrets[key];
  }
  writeConfigFile(cfg, opts, env);
}

export function deleteConfig(key: string, opts: StoreOptions, env: NodeJS.ProcessEnv = process.env): void {
  assertSafeConfigKey(key);
  const cfg = readConfigFile(opts, env);
  delete cfg.plain[key];
  delete cfg.secrets[key];
  writeConfigFile(cfg, opts, env);
}
