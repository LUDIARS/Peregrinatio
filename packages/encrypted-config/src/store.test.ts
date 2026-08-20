import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readConfigFile, setConfig, type StoreOptions } from './store.js';

const options: StoreOptions = {
  secretKeys: new Set(),
  configPathEnv: 'CONFIG_PATH',
  masterKeyEnv: 'CONFIG_MASTER_KEY',
  defaultConfigFile: 'config.json',
  masterSecretPrefix: 'test',
};

const tempDirs: string[] = [];

function configPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'encrypted-config-'));
  tempDirs.push(dir);
  return join(dir, 'config.json');
}

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('encrypted config store', () => {
  it('rejects malformed config instead of overwriting it during an update', () => {
    const path = configPath();
    const malformed = '{not valid json';
    writeFileSync(path, malformed, 'utf8');

    expect(() => setConfig('PORT', '8090', options, { CONFIG_PATH: path })).toThrow(SyntaxError);
    expect(readFileSync(path, 'utf8')).toBe(malformed);
  });

  it('rejects unsafe keys and non-string plain values', () => {
    const path = configPath();
    writeFileSync(path, JSON.stringify({ plain: { PORT: 8090 }, secrets: {} }), 'utf8');

    expect(() => readConfigFile(options, { CONFIG_PATH: path })).toThrow('Invalid plain config value');
    expect(() => setConfig('__proto__', 'unsafe', options, { CONFIG_PATH: path })).toThrow('Unsupported config key');
  });
});
