import { describe, test, expect, beforeEach, afterEach } from 'vitest';
const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createWebSocketHub } = require('../src/websocket-hub.js');
const { createHookReceiver } = require('../src/hook-receiver.js');

const NOTIFY_SCRIPT = path.resolve(__dirname, '../../scripts/notify.js');

function connectClient(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.on('open', () => {
      ws.removeAllListeners('error');
      ws.on('error', () => {});
      resolve(ws);
    });
    ws.on('error', reject);
  });
}

function waitForMessage(ws, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('timeout waiting for WS message')),
      timeoutMs
    );
    ws.once('message', (data) => {
      clearTimeout(timeout);
      resolve(JSON.parse(data.toString()));
    });
  });
}

function spawnNotify(event, stdinData, configDir) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [NOTIFY_SCRIPT, event], {
      env: { ...process.env, CLAWD_PHONE_CONFIG_DIR: configDir },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    if (stdinData) {
      child.stdin.write(JSON.stringify(stdinData));
    }
    child.stdin.end();
    child.on('close', (code) => resolve(code));
    setTimeout(() => resolve(-1), 8000);
  });
}

describe('E2E: notify.js → server → WebSocket client', () => {
  let server;
  let hub;
  let hookReceiver;
  let serverPort;
  let tmpDir;

  beforeEach(async () => {
    const config = {
      hookSecret: '',
      oneshotDurationMs: 200,
      sleepTimeoutMs: 500
    };

    const app = express();
    server = http.createServer(app);
    hub = createWebSocketHub(server);
    hookReceiver = createHookReceiver({ config, broadcast: hub.broadcast });
    app.use(hookReceiver.router);

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        resolve();
      });
    });

    tmpDir = path.join(os.tmpdir(), `clawd-e2e-chain-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({
      host: '127.0.0.1',
      port: serverPort,
      hookSecret: ''
    }));
  });

  afterEach(async () => {
    hookReceiver.cleanup();
    hub.cleanup();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('SessionStart event flows from notify.js stdin to WS client', async () => {
    const ws = await connectClient(serverPort);
    const msgPromise = waitForMessage(ws);

    const exitCode = await spawnNotify('SessionStart', {
      session_id: 'e2e-session-1',
      cwd: '/home/user/project'
    }, tmpDir);

    expect(exitCode).toBe(0);

    const msg = await msgPromise;
    expect(msg.type).toBe('task_event');
    expect(msg.data.event).toBe('SessionStart');
    expect(msg.data.sessionId).toBe('e2e-session-1');
    expect(msg.data.resolvedState).toBe('idle');

    ws.close();
  });

  test('PreToolUse event sets state to working', async () => {
    const ws = await connectClient(serverPort);

    const msg1Promise = waitForMessage(ws);
    await spawnNotify('SessionStart', { session_id: 's1' }, tmpDir);
    await msg1Promise;

    const msg2Promise = waitForMessage(ws);
    const exitCode = await spawnNotify('PreToolUse', {
      session_id: 's1',
      tool_name: 'Bash',
      tool_input: { command: 'ls' }
    }, tmpDir);

    expect(exitCode).toBe(0);
    const msg = await msg2Promise;
    expect(msg.data.event).toBe('PreToolUse');
    expect(msg.data.resolvedState).toBe('working');

    ws.close();
  });

  test('Stop event sets state to attention', async () => {
    const ws = await connectClient(serverPort);

    const msg1Promise = waitForMessage(ws);
    await spawnNotify('SessionStart', { session_id: 's2' }, tmpDir);
    await msg1Promise;

    const msg2Promise = waitForMessage(ws);
    await spawnNotify('Stop', { session_id: 's2', source: 'user' }, tmpDir);
    const msg = await msg2Promise;

    expect(msg.data.resolvedState).toBe('attention');
    ws.close();
  });

  test('multiple WS clients all receive the broadcast', async () => {
    const ws1 = await connectClient(serverPort);
    const ws2 = await connectClient(serverPort);

    const p1 = waitForMessage(ws1);
    const p2 = waitForMessage(ws2);

    await spawnNotify('SessionStart', { session_id: 's3' }, tmpDir);

    const [msg1, msg2] = await Promise.all([p1, p2]);
    expect(msg1.data.event).toBe('SessionStart');
    expect(msg2.data.event).toBe('SessionStart');

    ws1.close();
    ws2.close();
  });

  test('event with no WS clients does not error', async () => {
    const exitCode = await spawnNotify('SessionStart', {
      session_id: 's4'
    }, tmpDir);

    expect(exitCode).toBe(0);
    expect(hookReceiver.getResolvedState()).toBe('idle');
  });
});

describe('E2E: hookSecret authentication chain', () => {
  let server;
  let hub;
  let hookReceiver;
  let serverPort;
  let tmpDir;

  beforeEach(async () => {
    const config = {
      hookSecret: 'e2e-test-secret',
      oneshotDurationMs: 200,
      sleepTimeoutMs: 500
    };

    const app = express();
    server = http.createServer(app);
    hub = createWebSocketHub(server);
    hookReceiver = createHookReceiver({ config, broadcast: hub.broadcast });
    app.use(hookReceiver.router);

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        resolve();
      });
    });

    tmpDir = path.join(os.tmpdir(), `clawd-e2e-auth-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    hookReceiver.cleanup();
    hub.cleanup();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('notify.js with matching secret reaches WS client', async () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({
      host: '127.0.0.1',
      port: serverPort,
      hookSecret: 'e2e-test-secret'
    }));

    const ws = await connectClient(serverPort);
    const msgPromise = waitForMessage(ws);

    const exitCode = await spawnNotify('SessionStart', {
      session_id: 'auth-session'
    }, tmpDir);

    expect(exitCode).toBe(0);
    const msg = await msgPromise;
    expect(msg.data.event).toBe('SessionStart');

    ws.close();
  });

  test('notify.js with wrong secret gets rejected (no WS broadcast)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({
      host: '127.0.0.1',
      port: serverPort,
      hookSecret: 'wrong-secret'
    }));

    const ws = await connectClient(serverPort);
    let received = false;
    ws.on('message', () => { received = true; });

    const exitCode = await spawnNotify('SessionStart', {
      session_id: 'bad-auth'
    }, tmpDir);

    expect(exitCode).toBe(0);
    await new Promise((r) => setTimeout(r, 300));
    expect(received).toBe(false);

    ws.close();
  });

  test('notify.js with no secret gets rejected', async () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({
      host: '127.0.0.1',
      port: serverPort,
      hookSecret: ''
    }));

    const ws = await connectClient(serverPort);
    let received = false;
    ws.on('message', () => { received = true; });

    await spawnNotify('SessionStart', { session_id: 'no-auth' }, tmpDir);

    await new Promise((r) => setTimeout(r, 300));
    expect(received).toBe(false);

    ws.close();
  });
});

describe('E2E: state machine transitions', () => {
  let server;
  let hub;
  let hookReceiver;
  let serverPort;
  let tmpDir;

  beforeEach(async () => {
    const config = {
      hookSecret: '',
      oneshotDurationMs: 200,
      sleepTimeoutMs: 60000
    };

    const app = express();
    server = http.createServer(app);
    hub = createWebSocketHub(server);
    hookReceiver = createHookReceiver({ config, broadcast: hub.broadcast });
    app.use(hookReceiver.router);

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        resolve();
      });
    });

    tmpDir = path.join(os.tmpdir(), `clawd-e2e-sm-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({
      host: '127.0.0.1',
      port: serverPort,
      hookSecret: ''
    }));
  });

  afterEach(async () => {
    hookReceiver.cleanup();
    hub.cleanup();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('full session lifecycle: Start → ToolUse → Stop → End', async () => {
    const ws = await connectClient(serverPort);
    const messages = [];

    const collectMsg = () => waitForMessage(ws).then((m) => {
      messages.push(m);
      return m;
    });

    let p = collectMsg();
    await spawnNotify('SessionStart', { session_id: 'lifecycle-1' }, tmpDir);
    await p;

    p = collectMsg();
    await spawnNotify('UserPromptSubmit', { session_id: 'lifecycle-1' }, tmpDir);
    await p;

    p = collectMsg();
    await spawnNotify('PreToolUse', { session_id: 'lifecycle-1', tool_name: 'Edit' }, tmpDir);
    await p;

    p = collectMsg();
    await spawnNotify('PostToolUse', { session_id: 'lifecycle-1' }, tmpDir);
    await p;

    p = collectMsg();
    await spawnNotify('Stop', { session_id: 'lifecycle-1' }, tmpDir);
    await p;

    p = collectMsg();
    await spawnNotify('SessionEnd', { session_id: 'lifecycle-1' }, tmpDir);
    await p;

    expect(messages).toHaveLength(6);
    expect(messages[0].data.resolvedState).toBe('idle');
    expect(messages[1].data.resolvedState).toBe('thinking');
    expect(messages[2].data.resolvedState).toBe('working');
    expect(messages[3].data.resolvedState).toBe('working');
    expect(messages[4].data.resolvedState).toBe('attention');
    expect(messages[5].data.resolvedState).toBe('idle');

    ws.close();
  });

  test('SubagentStart → SubagentStop resumes previous state', async () => {
    const ws = await connectClient(serverPort);

    let p = waitForMessage(ws);
    await spawnNotify('SessionStart', { session_id: 'sub-1' }, tmpDir);
    await p;

    p = waitForMessage(ws);
    await spawnNotify('PreToolUse', { session_id: 'sub-1' }, tmpDir);
    const workingMsg = await p;
    expect(workingMsg.data.resolvedState).toBe('working');

    p = waitForMessage(ws);
    await spawnNotify('SubagentStart', { session_id: 'sub-1' }, tmpDir);
    const juggleMsg = await p;
    expect(juggleMsg.data.resolvedState).toBe('juggling');

    p = waitForMessage(ws);
    await spawnNotify('SubagentStop', { session_id: 'sub-1' }, tmpDir);
    const resumeMsg = await p;
    expect(resumeMsg.data.resolvedState).toBe('working');

    ws.close();
  });

  test('error event triggers oneshot and returns to previous state', async () => {
    const ws = await connectClient(serverPort);

    let p = waitForMessage(ws);
    await spawnNotify('SessionStart', { session_id: 'err-1' }, tmpDir);
    await p;

    p = waitForMessage(ws);
    await spawnNotify('PreToolUse', { session_id: 'err-1' }, tmpDir);
    await p;

    p = waitForMessage(ws);
    await spawnNotify('PostToolUseFailure', { session_id: 'err-1' }, tmpDir);
    const errMsg = await p;
    expect(errMsg.data.resolvedState).toBe('error');

    const returnMsg = await waitForMessage(ws, 2000);
    expect(returnMsg.data.event).toBe('OneshotReturn');
    expect(returnMsg.data.resolvedState).toBe('working');

    ws.close();
  });
});

describe('E2E: adversarial scenarios', () => {
  let server;
  let hub;
  let hookReceiver;
  let serverPort;
  let tmpDir;

  beforeEach(async () => {
    const config = {
      hookSecret: '',
      oneshotDurationMs: 200,
      sleepTimeoutMs: 500
    };

    const app = express();
    server = http.createServer(app);
    hub = createWebSocketHub(server);
    hookReceiver = createHookReceiver({ config, broadcast: hub.broadcast });
    app.use(hookReceiver.router);

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        resolve();
      });
    });

    tmpDir = path.join(os.tmpdir(), `clawd-e2e-adv-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({
      host: '127.0.0.1',
      port: serverPort,
      hookSecret: ''
    }));
  });

  afterEach(async () => {
    hookReceiver.cleanup();
    hub.cleanup();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('rapid-fire events from different sessions', async () => {
    const ws = await connectClient(serverPort);
    const messages = [];
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())));

    await Promise.all([
      spawnNotify('SessionStart', { session_id: 'rapid-1' }, tmpDir),
      spawnNotify('SessionStart', { session_id: 'rapid-2' }, tmpDir),
      spawnNotify('PreToolUse', { session_id: 'rapid-3' }, tmpDir)
    ]);

    await new Promise((r) => setTimeout(r, 500));
    expect(messages.length).toBeGreaterThanOrEqual(3);

    ws.close();
  });

  test('notify.js exits 0 when server is not running', async () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({
      host: '127.0.0.1',
      port: 1,
      hookSecret: ''
    }));

    const exitCode = await spawnNotify('SessionStart', {
      session_id: 'no-server'
    }, tmpDir);

    expect(exitCode).toBe(0);
  });

  test('WS client disconnects mid-session does not crash server', async () => {
    const ws = await connectClient(serverPort);
    ws.close();
    await new Promise((r) => setTimeout(r, 100));

    const exitCode = await spawnNotify('SessionStart', {
      session_id: 'after-disconnect'
    }, tmpDir);

    expect(exitCode).toBe(0);
    expect(hookReceiver.getResolvedState()).toBe('idle');
  });
});
