import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  readToken,
  maskToken,
  transformApiResponse,
  parseRetryAfterSeconds,
  createUsagePoller
} = require('../src/usage-poller.js');

function makeMockApiResponse(overrides = {}) {
  return JSON.stringify({
    five_hour: { utilization: 42, resets_at: '2025-01-15T10:00:00Z' },
    seven_day: { utilization: 17, resets_at: '2025-01-20T00:00:00Z' },
    seven_day_sonnet: { utilization: 8, resets_at: '2025-01-20T00:00:00Z' },
    seven_day_opus: null,
    extra_usage: {
      is_enabled: true,
      monthly_limit: 400000,
      used_credits: 106,
      utilization: 0.026,
      currency: 'usd',
      disabled_reason: null
    },
    ...overrides
  });
}

function writeCreds(dir, token) {
  const claudeDir = path.join(dir, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudeDir, '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: token } }),
    'utf-8'
  );
  return path.join(claudeDir, '.credentials.json');
}

// --- Happy Path ---

describe('readToken - happy path', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawd-poller-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('reads valid token from credentials file', () => {
    const credPath = writeCreds(tmpDir, 'test-token-abc123');
    const result = readToken(credPath);

    expect(result.token).toBe('test-token-abc123');
    expect(result.error).toBeNull();
  });
});

describe('maskToken', () => {
  test('masks token showing only first 8 chars', () => {
    expect(maskToken('abcdefghijklmnop')).toBe('abcdefgh...');
  });

  test('returns *** for null/short token', () => {
    expect(maskToken(null)).toBe('***');
    expect(maskToken('short')).toBe('***');
  });
});

describe('transformApiResponse - happy path', () => {
  test('transforms complete API response', () => {
    const result = transformApiResponse(makeMockApiResponse());

    expect(result.sessionUsage).toBe(42);
    expect(result.sessionResetAt).toBe('2025-01-15T10:00:00Z');
    expect(result.weeklyUsage).toBe(17);
    expect(result.weeklySonnetUsage).toBe(8);
    expect(result.weeklyOpusUsage).toBeNull();
    expect(result.extraUsageEnabled).toBe(true);
    expect(result.extraUsageUsed).toBe(106);
    expect(result.error).toBeNull();
    expect(result.lastUpdatedAt).toBeDefined();
  });

  test('transforms minimal response with null buckets', () => {
    const minimal = JSON.stringify({
      five_hour: { utilization: 0, resets_at: null },
      seven_day: null
    });
    const result = transformApiResponse(minimal);

    expect(result.sessionUsage).toBe(0);
    expect(result.weeklyUsage).toBeNull();
  });
});

describe('parseRetryAfterSeconds', () => {
  test('parses numeric header', () => {
    expect(parseRetryAfterSeconds('30')).toBe(30);
  });

  test('defaults to 60 for null', () => {
    expect(parseRetryAfterSeconds(null)).toBe(60);
  });

  test('defaults to 60 for invalid', () => {
    expect(parseRetryAfterSeconds('abc')).toBe(60);
  });
});

// --- Edge/Error Cases ---

describe('readToken - error cases', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawd-poller-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns no-credentials when file does not exist', () => {
    const result = readToken(path.join(tmpDir, 'nonexistent', '.credentials.json'));

    expect(result.token).toBeNull();
    expect(result.error).toBe('no-credentials');
  });

  test('returns parse-error when file is invalid JSON', () => {
    const credPath = path.join(tmpDir, '.credentials.json');
    fs.writeFileSync(credPath, '{broken json', 'utf-8');
    const result = readToken(credPath);

    expect(result.token).toBeNull();
    expect(result.error).toBe('parse-error');
  });

  test('returns no-credentials when token field missing', () => {
    const credPath = path.join(tmpDir, '.credentials.json');
    fs.writeFileSync(credPath, JSON.stringify({ other: 'data' }), 'utf-8');
    const result = readToken(credPath);

    expect(result.token).toBeNull();
    expect(result.error).toBe('no-credentials');
  });

  test('returns no-credentials when accessToken is empty string', () => {
    const credPath = path.join(tmpDir, '.credentials.json');
    fs.writeFileSync(credPath, JSON.stringify({
      claudeAiOauth: { accessToken: '' }
    }), 'utf-8');
    const result = readToken(credPath);

    expect(result.token).toBeNull();
    expect(result.error).toBe('no-credentials');
  });

  test('handles tilde expansion in path', () => {
    const result = readToken('~/nonexistent/.credentials.json');
    expect(result.error).toBe('no-credentials');
  });
});

describe('transformApiResponse - error cases', () => {
  test('throws on invalid JSON', () => {
    expect(() => transformApiResponse('not json')).toThrow();
  });

  test('throws on missing required fields', () => {
    expect(() => transformApiResponse('{}')).toThrow();
  });

  test('handles response with only five_hour null', () => {
    const response = JSON.stringify({
      five_hour: null,
      seven_day: { utilization: 10, resets_at: '2025-01-20T00:00:00Z' }
    });
    const result = transformApiResponse(response);

    expect(result.sessionUsage).toBeNull();
    expect(result.weeklyUsage).toBe(10);
  });
});

describe('createUsagePoller - lifecycle', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawd-poller-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('broadcasts error when token not found', async () => {
    const messages = [];
    const poller = createUsagePoller({
      config: {
        claudeCredentialsPath: path.join(tmpDir, 'nonexistent.json'),
        pollIntervalSeconds: 60
      },
      broadcast: (msg) => messages.push(msg)
    });

    await poller.pollNow();

    expect(messages.length).toBe(1);
    expect(messages[0].type).toBe('usage_update');
    expect(messages[0].data.error).toBe('no-credentials');
    poller.stop();
  });

  test('broadcasts error when credentials file is corrupted', async () => {
    const credPath = path.join(tmpDir, '.credentials.json');
    fs.writeFileSync(credPath, 'not json', 'utf-8');

    const messages = [];
    const poller = createUsagePoller({
      config: {
        claudeCredentialsPath: credPath,
        pollIntervalSeconds: 60
      },
      broadcast: (msg) => messages.push(msg)
    });

    await poller.pollNow();

    expect(messages[0].data.error).toBe('parse-error');
    poller.stop();
  });

  test('getStatus reports initial state', () => {
    const poller = createUsagePoller({
      config: {
        claudeCredentialsPath: '/nonexistent',
        pollIntervalSeconds: 30
      },
      broadcast: () => {}
    });

    const status = poller.getStatus();
    expect(status.isRunning).toBe(false);
    expect(status.consecutiveErrors).toBe(0);
    expect(status.currentIntervalMs).toBe(30000);
  });

  test('start sets isRunning', async () => {
    const poller = createUsagePoller({
      config: {
        claudeCredentialsPath: path.join(tmpDir, 'nonexistent.json'),
        pollIntervalSeconds: 999
      },
      broadcast: () => {}
    });

    poller.start();
    expect(poller.getStatus().isRunning).toBe(true);

    await new Promise((r) => setTimeout(r, 100));
    poller.stop();
    expect(poller.getStatus().isRunning).toBe(false);
  });
});

// --- Adversarial ---

describe('createUsagePoller - backoff', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawd-poller-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('increases interval on consecutive errors', async () => {
    const poller = createUsagePoller({
      config: {
        claudeCredentialsPath: path.join(tmpDir, 'nonexistent.json'),
        pollIntervalSeconds: 60
      },
      broadcast: () => {}
    });

    poller.start();
    await new Promise((r) => setTimeout(r, 50));

    expect(poller.getStatus().consecutiveErrors).toBe(1);
    expect(poller.getStatus().currentIntervalMs).toBe(120000);
    poller.stop();
  });

  test('caps backoff at 300 seconds', async () => {
    const poller = createUsagePoller({
      config: {
        claudeCredentialsPath: path.join(tmpDir, 'nonexistent.json'),
        pollIntervalSeconds: 60
      },
      broadcast: () => {}
    });

    // Simulate multiple errors manually
    for (let i = 0; i < 10; i++) {
      await poller.pollNow();
    }

    expect(poller.getStatus().currentIntervalMs).toBeLessThanOrEqual(300000);
    poller.stop();
  });
});

describe('transformApiResponse - adversarial', () => {
  test('handles extra unknown bucket keys via passthrough', () => {
    const response = JSON.stringify({
      five_hour: { utilization: 50, resets_at: '2025-01-15T10:00:00Z' },
      seven_day: { utilization: 20, resets_at: '2025-01-20T00:00:00Z' },
      iguana_necktie: { utilization: 5, resets_at: '2025-01-20T00:00:00Z' }
    });

    const result = transformApiResponse(response);
    expect(result.sessionUsage).toBe(50);
  });

  test('handles zero utilization correctly', () => {
    const response = JSON.stringify({
      five_hour: { utilization: 0, resets_at: '2025-01-15T10:00:00Z' },
      seven_day: { utilization: 0, resets_at: '2025-01-20T00:00:00Z' }
    });

    const result = transformApiResponse(response);
    expect(result.sessionUsage).toBe(0);
    expect(result.weeklyUsage).toBe(0);
  });

  test('handles 100 utilization correctly', () => {
    const response = JSON.stringify({
      five_hour: { utilization: 100, resets_at: '2025-01-15T10:00:00Z' },
      seven_day: { utilization: 100, resets_at: '2025-01-20T00:00:00Z' }
    });

    const result = transformApiResponse(response);
    expect(result.sessionUsage).toBe(100);
    expect(result.weeklyUsage).toBe(100);
  });

  test('rejects array input', () => {
    expect(() => transformApiResponse('[]')).toThrow();
  });

  test('rejects number input', () => {
    expect(() => transformApiResponse('42')).toThrow();
  });
});
