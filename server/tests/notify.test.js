import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Readable } = require('stream');

const {
  TIMEOUT_MS,
  STDIN_TIMEOUT_MS,
  getServerUrl,
  getHookSecret,
  buildBody,
  postToServer,
  loadConfig,
  getConfigPath,
  readStdinJson
} = require('../../scripts/notify.js');

describe('notify.js constants', () => {
  test('TIMEOUT_MS is 2 seconds', () => {
    expect(TIMEOUT_MS).toBe(2000);
  });

  test('STDIN_TIMEOUT_MS is 400ms', () => {
    expect(STDIN_TIMEOUT_MS).toBe(400);
  });
});

describe('getServerUrl', () => {
  test('returns localhost when host is 0.0.0.0', () => {
    expect(getServerUrl({ host: '0.0.0.0', port: 9870 }))
      .toBe('http://127.0.0.1:9870');
  });

  test('returns configured host and port', () => {
    expect(getServerUrl({ host: '192.168.1.50', port: 8080 }))
      .toBe('http://192.168.1.50:8080');
  });

  test('defaults port to 9870 when missing', () => {
    expect(getServerUrl({ host: '10.0.0.1' }))
      .toBe('http://10.0.0.1:9870');
  });

  test('defaults host to 127.0.0.1 when missing', () => {
    expect(getServerUrl({})).toBe('http://127.0.0.1:9870');
  });
});

describe('getHookSecret', () => {
  test('returns secret when present', () => {
    expect(getHookSecret({ hookSecret: 'my-secret' })).toBe('my-secret');
  });

  test('returns empty string when not set', () => {
    expect(getHookSecret({})).toBe('');
  });

  test('returns empty string for falsy value', () => {
    expect(getHookSecret({ hookSecret: '' })).toBe('');
  });
});

describe('buildBody', () => {
  test('maps session_id from stdin to sessionId', () => {
    const body = buildBody('SessionStart', { session_id: 'abc-123', cwd: '/home/user' });
    expect(body.event).toBe('SessionStart');
    expect(body.sessionId).toBe('abc-123');
    expect(body.cwd).toBe('/home/user');
    expect(body.timestamp).toBeDefined();
  });

  test('omits sessionId and cwd when not in stdin data', () => {
    const body = buildBody('PreToolUse', {});
    expect(body.event).toBe('PreToolUse');
    expect(body.sessionId).toBeUndefined();
    expect(body.cwd).toBeUndefined();
  });

  test('includes ISO timestamp', () => {
    const body = buildBody('Stop', {});
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('preserves event name exactly as given', () => {
    const body = buildBody('PostToolUseFailure', { session_id: 's1' });
    expect(body.event).toBe('PostToolUseFailure');
  });

  test('passes through extra stdin fields via spread', () => {
    const body = buildBody('PreToolUse', {
      session_id: 's1',
      cwd: '/tmp',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      tool_use_id: 'toolu_xyz'
    });
    expect(body.tool_name).toBe('Bash');
    expect(body.tool_input).toEqual({ command: 'ls' });
    expect(body.tool_use_id).toBe('toolu_xyz');
    expect(body.sessionId).toBe('s1');
  });
});

describe('loadConfig', () => {
  const tmpDir = path.join(os.tmpdir(), `notify-config-test-${Date.now()}`);
  let origEnv;

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    origEnv = process.env.CLAWD_PHONE_CONFIG_DIR;
    process.env.CLAWD_PHONE_CONFIG_DIR = tmpDir;
  });

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.CLAWD_PHONE_CONFIG_DIR;
    } else {
      process.env.CLAWD_PHONE_CONFIG_DIR = origEnv;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('reads config from CLAWD_PHONE_CONFIG_DIR', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({
      host: '10.0.0.5', port: 1234, hookSecret: 'test-secret'
    }));
    const config = loadConfig();
    expect(config.host).toBe('10.0.0.5');
    expect(config.port).toBe(1234);
    expect(config.hookSecret).toBe('test-secret');
  });

  test('returns empty object when config file is missing', () => {
    const config = loadConfig();
    expect(config).toEqual({});
  });

  test('returns empty object for corrupt JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), 'not json{{{');
    const config = loadConfig();
    expect(config).toEqual({});
  });
});

describe('postToServer', () => {
  let server;
  let receivedRequests;
  let serverPort;

  beforeEach(async () => {
    receivedRequests = [];
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        receivedRequests.push({
          method: req.method,
          url: req.url,
          headers: { ...req.headers },
          body: body ? JSON.parse(body) : null
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ state: 'idle' }));
      });
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test('sends POST to /api/hook with correct body', async () => {
    const body = { event: 'SessionStart', timestamp: new Date().toISOString() };
    const status = await postToServer(`http://127.0.0.1:${serverPort}`, body, '');

    expect(status).toBe(200);
    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].method).toBe('POST');
    expect(receivedRequests[0].url).toBe('/api/hook');
    expect(receivedRequests[0].body.event).toBe('SessionStart');
    expect(receivedRequests[0].headers['content-type']).toBe('application/json');
  });

  test('includes Authorization header when secret is provided', async () => {
    const body = { event: 'PreToolUse', timestamp: new Date().toISOString() };
    await postToServer(`http://127.0.0.1:${serverPort}`, body, 'my-secret');

    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].headers['authorization']).toBe('Bearer my-secret');
  });

  test('omits Authorization header when secret is empty', async () => {
    const body = { event: 'Stop', timestamp: new Date().toISOString() };
    await postToServer(`http://127.0.0.1:${serverPort}`, body, '');

    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].headers['authorization']).toBeUndefined();
  });

  test('resolves 0 when server is unreachable', async () => {
    const status = await postToServer('http://127.0.0.1:1', { event: 'SessionStart' }, '');
    expect(status).toBe(0);
  });

  test('resolves 0 on timeout', async () => {
    const slowServer = http.createServer(() => {
      // never respond
    });
    const slowPort = await new Promise((resolve) => {
      slowServer.listen(0, '127.0.0.1', () => resolve(slowServer.address().port));
    });

    const status = await postToServer(`http://127.0.0.1:${slowPort}`, { event: 'Stop' }, '');
    expect(status).toBe(0);

    await new Promise((resolve) => slowServer.close(resolve));
  });
});

describe('E2E: child process integration', () => {
  let server;
  let receivedRequests;
  let serverPort;
  let tmpDir;

  beforeEach(async () => {
    receivedRequests = [];
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        receivedRequests.push({
          method: req.method,
          url: req.url,
          headers: { ...req.headers },
          body: body ? JSON.parse(body) : null
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ state: 'idle' }));
      });
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        resolve();
      });
    });

    tmpDir = path.join(os.tmpdir(), `clawd-e2e-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({
      host: '127.0.0.1',
      port: serverPort,
      hookSecret: ''
    }));
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('notify.js child process sends correct POST from stdin', async () => {
    const { spawn } = require('child_process');
    const scriptPath = path.resolve(__dirname, '../../scripts/notify.js');

    const exitCode = await new Promise((resolve) => {
      const child = spawn(process.execPath, [scriptPath, 'SessionStart'], {
        env: { ...process.env, CLAWD_PHONE_CONFIG_DIR: tmpDir },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      child.stdin.write(JSON.stringify({
        session_id: 'test-session-123',
        cwd: '/home/user/project'
      }));
      child.stdin.end();

      child.on('close', (code) => resolve(code));
      setTimeout(() => resolve(-1), 5000);
    });

    expect(exitCode).toBe(0);
    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].method).toBe('POST');
    expect(receivedRequests[0].url).toBe('/api/hook');
    expect(receivedRequests[0].body.event).toBe('SessionStart');
    expect(receivedRequests[0].body.sessionId).toBe('test-session-123');
    expect(receivedRequests[0].body.cwd).toBe('/home/user/project');
    expect(receivedRequests[0].body.timestamp).toBeDefined();
  });

  test('notify.js exits 0 with no event argument', async () => {
    const { spawn } = require('child_process');
    const scriptPath = path.resolve(__dirname, '../../scripts/notify.js');

    const exitCode = await new Promise((resolve) => {
      const child = spawn(process.execPath, [scriptPath], {
        env: { ...process.env, CLAWD_PHONE_CONFIG_DIR: tmpDir },
        stdio: ['pipe', 'pipe', 'pipe']
      });
      child.stdin.end();
      child.on('close', (code) => resolve(code));
      setTimeout(() => resolve(-1), 5000);
    });

    expect(exitCode).toBe(0);
    expect(receivedRequests).toHaveLength(0);
  });

  test('notify.js passes through extra stdin fields to server', async () => {
    const { spawn } = require('child_process');
    const scriptPath = path.resolve(__dirname, '../../scripts/notify.js');

    const exitCode = await new Promise((resolve) => {
      const child = spawn(process.execPath, [scriptPath, 'PreToolUse'], {
        env: { ...process.env, CLAWD_PHONE_CONFIG_DIR: tmpDir },
        stdio: ['pipe', 'pipe', 'pipe']
      });
      child.stdin.write(JSON.stringify({
        session_id: 's1',
        cwd: '/tmp',
        tool_name: 'Bash',
        tool_input: { command: 'ls -la' }
      }));
      child.stdin.end();
      child.on('close', (code) => resolve(code));
      setTimeout(() => resolve(-1), 5000);
    });

    expect(exitCode).toBe(0);
    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].body.tool_name).toBe('Bash');
    expect(receivedRequests[0].body.tool_input).toEqual({ command: 'ls -la' });
  });

  test('notify.js handles malformed stdin JSON gracefully', async () => {
    const { spawn } = require('child_process');
    const scriptPath = path.resolve(__dirname, '../../scripts/notify.js');

    const exitCode = await new Promise((resolve) => {
      const child = spawn(process.execPath, [scriptPath, 'SessionStart'], {
        env: { ...process.env, CLAWD_PHONE_CONFIG_DIR: tmpDir },
        stdio: ['pipe', 'pipe', 'pipe']
      });
      child.stdin.write('not valid json {{{');
      child.stdin.end();
      child.on('close', (code) => resolve(code));
      setTimeout(() => resolve(-1), 5000);
    });

    expect(exitCode).toBe(0);
    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].body.event).toBe('SessionStart');
    expect(receivedRequests[0].body.sessionId).toBeUndefined();
  });

  test('notify.js handles empty stdin', async () => {
    const { spawn } = require('child_process');
    const scriptPath = path.resolve(__dirname, '../../scripts/notify.js');

    const exitCode = await new Promise((resolve) => {
      const child = spawn(process.execPath, [scriptPath, 'Stop'], {
        env: { ...process.env, CLAWD_PHONE_CONFIG_DIR: tmpDir },
        stdio: ['pipe', 'pipe', 'pipe']
      });
      child.stdin.end();
      child.on('close', (code) => resolve(code));
      setTimeout(() => resolve(-1), 5000);
    });

    expect(exitCode).toBe(0);
    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].body.event).toBe('Stop');
    expect(receivedRequests[0].body.sessionId).toBeUndefined();
  });
});

describe('adversarial: getServerUrl edge cases', () => {
  test('handles port as string type', () => {
    expect(getServerUrl({ host: '10.0.0.1', port: '8080' }))
      .toBe('http://10.0.0.1:8080');
  });

  test('handles null host', () => {
    expect(getServerUrl({ host: null, port: 9870 }))
      .toBe('http://127.0.0.1:9870');
  });

  test('handles port 0 (falsy)', () => {
    expect(getServerUrl({ host: '10.0.0.1', port: 0 }))
      .toBe('http://10.0.0.1:9870');
  });
});

describe('adversarial: postToServer edge cases', () => {
  test('resolves non-200 status code', async () => {
    const errServer = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(500);
        res.end('Internal Server Error');
      });
    });
    const errPort = await new Promise((resolve) => {
      errServer.listen(0, '127.0.0.1', () => resolve(errServer.address().port));
    });

    const status = await postToServer(
      `http://127.0.0.1:${errPort}`,
      { event: 'Stop' },
      ''
    );
    expect(status).toBe(500);

    await new Promise((resolve) => errServer.close(resolve));
  });

  test('handles body with unicode content', async () => {
    let receivedBody = null;
    const uniServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        receivedBody = JSON.parse(body);
        res.writeHead(200);
        res.end('{}');
      });
    });
    const uniPort = await new Promise((resolve) => {
      uniServer.listen(0, '127.0.0.1', () => resolve(uniServer.address().port));
    });

    await postToServer(
      `http://127.0.0.1:${uniPort}`,
      { event: 'SessionStart', cwd: '/home/用户/项目' },
      ''
    );
    expect(receivedBody.cwd).toBe('/home/用户/项目');

    await new Promise((resolve) => uniServer.close(resolve));
  });
});

describe('adversarial: loadConfig edge cases', () => {
  const tmpDir = path.join(os.tmpdir(), `notify-adv-${Date.now()}`);
  let origEnv;

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    origEnv = process.env.CLAWD_PHONE_CONFIG_DIR;
    process.env.CLAWD_PHONE_CONFIG_DIR = tmpDir;
  });

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.CLAWD_PHONE_CONFIG_DIR;
    } else {
      process.env.CLAWD_PHONE_CONFIG_DIR = origEnv;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('handles config with unexpected types (port as string)', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({
      host: '10.0.0.1', port: '8080'
    }));
    const config = loadConfig();
    expect(config.port).toBe('8080');
    const url = getServerUrl(config);
    expect(url).toBe('http://10.0.0.1:8080');
  });

  test('handles empty config file', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), '');
    const config = loadConfig();
    expect(config).toEqual({});
  });

  test('handles config pointing to non-existent directory', () => {
    process.env.CLAWD_PHONE_CONFIG_DIR = path.join(tmpDir, 'does-not-exist');
    const config = loadConfig();
    expect(config).toEqual({});
  });
});
