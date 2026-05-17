import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';
const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  ConfigSchema,
  expandTilde,
  getConfigDir,
  getConfigPath,
  getDefaults,
  loadConfig,
  saveConfig
} = require('../src/config.js');

describe('expandTilde', () => {
  test('expands ~ to home directory', () => {
    const result = expandTilde('~/.clawd-phone/config.json');
    expect(result).toBe(path.join(os.homedir(), '.clawd-phone/config.json'));
  });

  test('does not modify absolute paths without tilde', () => {
    const input = '/etc/clawd/config.json';
    expect(expandTilde(input)).toBe(input);
  });

  test('does not modify relative paths', () => {
    const input = './config.json';
    expect(expandTilde(input)).toBe(input);
  });

  test('handles tilde at start only', () => {
    const input = 'path/with/~/in/middle';
    expect(expandTilde(input)).toBe(input);
  });
});

describe('ConfigSchema - validation', () => {
  test('returns defaults for empty object', () => {
    const result = ConfigSchema.parse({});
    expect(result.port).toBe(9870);
    expect(result.host).toBe('0.0.0.0');
    expect(result.pollIntervalSeconds).toBe(60);
    expect(result.hookSecret).toBe('');
    expect(result.claudeCredentialsPath).toBe('~/.claude/.credentials.json');
  });

  test('accepts valid custom config', () => {
    const config = {
      port: 8080,
      host: '127.0.0.1',
      pollIntervalSeconds: 30,
      hookSecret: 'my-secret-123'
    };
    const result = ConfigSchema.parse(config);
    expect(result.port).toBe(8080);
    expect(result.hookSecret).toBe('my-secret-123');
  });

  test('rejects port below 1024', () => {
    expect(() => ConfigSchema.parse({ port: 80 })).toThrow();
  });

  test('rejects port above 65535', () => {
    expect(() => ConfigSchema.parse({ port: 70000 })).toThrow();
  });

  test('rejects pollIntervalSeconds below 10', () => {
    expect(() => ConfigSchema.parse({ pollIntervalSeconds: 5 })).toThrow();
  });

  test('rejects pollIntervalSeconds above 600', () => {
    expect(() => ConfigSchema.parse({ pollIntervalSeconds: 1000 })).toThrow();
  });
});

describe('getConfigDir', () => {
  const originalEnv = process.env.CLAWD_PHONE_CONFIG_DIR;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.CLAWD_PHONE_CONFIG_DIR;
    } else {
      process.env.CLAWD_PHONE_CONFIG_DIR = originalEnv;
    }
  });

  test('uses env var when set', () => {
    process.env.CLAWD_PHONE_CONFIG_DIR = '/custom/config/dir';
    expect(getConfigDir()).toBe('/custom/config/dir');
  });

  test('expands tilde in env var', () => {
    process.env.CLAWD_PHONE_CONFIG_DIR = '~/.my-clawd';
    expect(getConfigDir()).toBe(path.join(os.homedir(), '.my-clawd'));
  });

  test('falls back to ~/.clawd-phone when no env var', () => {
    delete process.env.CLAWD_PHONE_CONFIG_DIR;
    expect(getConfigDir()).toBe(path.join(os.homedir(), '.clawd-phone'));
  });
});

describe('loadConfig - filesystem', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawd-config-test-'));
    process.env.CLAWD_PHONE_CONFIG_DIR = tmpDir;
  });

  afterEach(() => {
    delete process.env.CLAWD_PHONE_CONFIG_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('creates default config file when none exists', () => {
    const config = loadConfig();
    expect(config.port).toBe(9870);
    expect(fs.existsSync(path.join(tmpDir, 'config.json'))).toBe(true);
  });

  test('reads existing config file', () => {
    const customConfig = { port: 4444, host: '192.168.1.100' };
    fs.writeFileSync(
      path.join(tmpDir, 'config.json'),
      JSON.stringify(customConfig),
      'utf-8'
    );
    const config = loadConfig();
    expect(config.port).toBe(4444);
    expect(config.host).toBe('192.168.1.100');
  });

  test('throws on invalid JSON in config file', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), '{broken json', 'utf-8');
    expect(() => loadConfig()).toThrow();
  });

  test('throws on invalid config values', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'config.json'),
      JSON.stringify({ port: 80 }),
      'utf-8'
    );
    expect(() => loadConfig()).toThrow();
  });
});

describe('saveConfig - filesystem', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawd-config-test-'));
    process.env.CLAWD_PHONE_CONFIG_DIR = tmpDir;
  });

  afterEach(() => {
    delete process.env.CLAWD_PHONE_CONFIG_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('writes valid config atomically', () => {
    const config = { port: 5555, host: '10.0.0.1' };
    const result = saveConfig(config);
    expect(result.port).toBe(5555);

    const onDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8'));
    expect(onDisk.port).toBe(5555);
  });

  test('rejects invalid config without writing', () => {
    expect(() => saveConfig({ port: 99999 })).toThrow();
    expect(fs.existsSync(path.join(tmpDir, 'config.json'))).toBe(false);
  });

  test('does not leave temp file on validation failure', () => {
    expect(() => saveConfig({ port: 99999 })).toThrow();
    const files = fs.readdirSync(tmpDir);
    expect(files).not.toContain('config.json.tmp');
  });
});
