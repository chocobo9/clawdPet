import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
const http = require('http');
const WebSocket = require('ws');
const { createWebSocketHub } = require('../src/websocket-hub.js');

const TEST_PORT = 19870;

function makeUsageUpdate() {
  return {
    type: 'usage_update',
    data: {
      sessionUsage: 42,
      sessionResetAt: '2025-01-15T10:00:00Z',
      weeklyUsage: 17,
      weeklyResetAt: '2025-01-20T00:00:00Z',
      error: null,
      lastUpdatedAt: '2025-01-15T05:00:00Z'
    }
  };
}

function makeTaskEvent() {
  return {
    type: 'task_event',
    data: {
      event: 'UserPromptSubmit',
      sessionId: 'test-session',
      timestamp: '2025-01-15T05:30:00Z'
    }
  };
}

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

function connectAndCollect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages = [];
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
    ws.on('open', () => resolve({ ws, messages }));
    ws.on('error', reject);
  });
}

function waitForMessage(ws) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout waiting for message')), 5000);
    ws.on('message', (data) => {
      clearTimeout(timeout);
      resolve(JSON.parse(data.toString()));
    });
  });
}

function waitForClose(ws) {
  return new Promise((resolve) => {
    ws.on('close', resolve);
  });
}

describe('WebSocket Hub', () => {
  let server;
  let hub;
  let clients;

  beforeEach(async () => {
    clients = [];
    server = http.createServer();
    hub = createWebSocketHub(server);
    await new Promise((resolve) => server.listen(TEST_PORT, '127.0.0.1', resolve));
  });

  afterEach(async () => {
    for (const c of clients) {
      c.removeAllListeners();
      c.on('error', () => {});
      if (c.readyState === WebSocket.OPEN || c.readyState === WebSocket.CONNECTING) {
        c.terminate();
      }
    }
    clients = [];
    hub.cleanup();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await new Promise((resolve) => server.close(resolve));
  });

  // --- Happy Path ---

  test('client can connect to /ws', async () => {
    const ws = await connectClient(TEST_PORT);
    clients.push(ws);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(hub.getClientCount()).toBe(1);
  });

  test('broadcasts usage_update to all connected clients', async () => {
    const ws1 = await connectClient(TEST_PORT);
    const ws2 = await connectClient(TEST_PORT);
    clients.push(ws1, ws2);

    const p1 = waitForMessage(ws1);
    const p2 = waitForMessage(ws2);

    hub.broadcast(makeUsageUpdate());

    const [msg1, msg2] = await Promise.all([p1, p2]);
    expect(msg1.type).toBe('usage_update');
    expect(msg2.type).toBe('usage_update');
    expect(msg1.data.sessionUsage).toBe(42);
  });

  test('broadcasts task_event to all clients', async () => {
    const ws = await connectClient(TEST_PORT);
    clients.push(ws);

    const p = waitForMessage(ws);
    hub.broadcast(makeTaskEvent());
    const msg = await p;

    expect(msg.type).toBe('task_event');
    expect(msg.data.event).toBe('UserPromptSubmit');
  });

  test('sends last usage_update to newly connected client', async () => {
    hub.broadcast(makeUsageUpdate());

    const { ws, messages } = await connectAndCollect(TEST_PORT);
    clients.push(ws);

    await new Promise((r) => setTimeout(r, 100));
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages[0].type).toBe('usage_update');
    expect(messages[0].data.sessionUsage).toBe(42);
  });

  test('getClientCount tracks connections', async () => {
    expect(hub.getClientCount()).toBe(0);

    const ws1 = await connectClient(TEST_PORT);
    clients.push(ws1);
    expect(hub.getClientCount()).toBe(1);

    const ws2 = await connectClient(TEST_PORT);
    clients.push(ws2);
    expect(hub.getClientCount()).toBe(2);
  });

  // --- Edge/Error Cases ---

  test('disconnect does not block other connections', async () => {
    const ws1 = await connectClient(TEST_PORT);
    const ws2 = await connectClient(TEST_PORT);
    clients.push(ws1, ws2);

    ws1.close();
    await waitForClose(ws1);

    const p = waitForMessage(ws2);
    hub.broadcast(makeUsageUpdate());
    const msg = await p;

    expect(msg.type).toBe('usage_update');
  });

  test('broadcast with no connected clients does not throw', () => {
    expect(hub.getClientCount()).toBe(0);
    expect(() => hub.broadcast(makeUsageUpdate())).not.toThrow();
  });

  test('rejects connection to non /ws path', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/invalid`);
    const closed = new Promise((resolve) => {
      ws.on('close', resolve);
      ws.on('error', resolve);
    });

    await closed;
    expect(ws.readyState).not.toBe(WebSocket.OPEN);
  });

  test('broadcast rejects invalid message schema', () => {
    expect(() => hub.broadcast({ type: 'invalid', data: {} })).toThrow();
  });

  test('getLastUsageUpdate returns null before any broadcast', () => {
    expect(hub.getLastUsageUpdate()).toBeNull();
  });

  test('getLastUsageUpdate returns last usage after broadcast', () => {
    hub.broadcast(makeUsageUpdate());
    const last = hub.getLastUsageUpdate();
    expect(last.type).toBe('usage_update');
    expect(last.data.sessionUsage).toBe(42);
  });

  test('task_event does not overwrite lastUsageUpdate', () => {
    hub.broadcast(makeUsageUpdate());
    hub.broadcast(makeTaskEvent());
    const last = hub.getLastUsageUpdate();
    expect(last.type).toBe('usage_update');
  });

  test('heartbeat terminates unresponsive clients', async () => {
    const localServer = http.createServer();
    const localHub = createWebSocketHub(localServer, { heartbeatMs: 200 });
    await new Promise((resolve) => localServer.listen(29870, '127.0.0.1', resolve));

    const ws = await connectClient(29870);
    ws.pong = function () {};

    const closed = waitForClose(ws);
    await closed;

    expect(ws.readyState).toBe(WebSocket.CLOSED);

    localHub.cleanup();
    await new Promise((resolve) => localServer.close(resolve));
  });

  // --- Adversarial ---

  test('broadcast error message type works', async () => {
    const ws = await connectClient(TEST_PORT);
    clients.push(ws);

    const p = waitForMessage(ws);
    hub.broadcast({ type: 'error', message: 'Something went wrong' });
    const msg = await p;

    expect(msg.type).toBe('error');
    expect(msg.message).toBe('Something went wrong');
  });

  test('rapid connect/disconnect does not crash', async () => {
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        connectClient(TEST_PORT).then((ws) => {
          clients.push(ws);
          ws.close();
          return waitForClose(ws);
        }).catch(() => {})
      );
    }
    await Promise.all(promises);
    expect(() => hub.broadcast(makeUsageUpdate())).not.toThrow();
  });

  test('cleanup terminates all clients', async () => {
    const ws1 = await connectClient(TEST_PORT);
    const ws2 = await connectClient(TEST_PORT);

    const closePromises = [waitForClose(ws1), waitForClose(ws2)];
    hub.cleanup();
    await Promise.all(closePromises);

    expect(ws1.readyState).toBe(WebSocket.CLOSED);
    expect(ws2.readyState).toBe(WebSocket.CLOSED);
  });
});
