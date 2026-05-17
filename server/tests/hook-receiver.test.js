import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
const http = require('http');
const express = require('express');
const { createHookReceiver } = require('../src/hook-receiver.js');

function makeConfig(overrides = {}) {
  return {
    hookSecret: '',
    oneshotDurationMs: 200,
    sleepTimeoutMs: 500,
    ...overrides
  };
}

function createTestApp(config) {
  const messages = [];
  const broadcast = (msg) => messages.push(msg);

  const receiver = createHookReceiver({ config, broadcast });
  const app = express();
  app.use(receiver.router);

  return { app, receiver, messages };
}

async function postHook(app, body, headers = {}) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    return { status: res.status, data };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function makeEvent(event, sessionId = 'session-1') {
  return {
    event,
    sessionId,
    timestamp: new Date().toISOString()
  };
}

// --- Happy Path (≤50%) ---

describe('Hook Receiver - happy path', () => {
  let config;

  beforeEach(() => {
    config = makeConfig();
  });

  test('accepts valid SessionStart event', async () => {
    const { app, receiver } = createTestApp(config);
    const result = await postHook(app, makeEvent('SessionStart'));

    expect(result.status).toBe(200);
    expect(result.data.state).toBe('idle');
    receiver.cleanup();
  });

  test('maps UserPromptSubmit to thinking state', async () => {
    const { app, receiver } = createTestApp(config);
    await postHook(app, makeEvent('SessionStart'));
    const result = await postHook(app, makeEvent('UserPromptSubmit'));

    expect(result.data.state).toBe('thinking');
    receiver.cleanup();
  });

  test('maps PreToolUse to working state', async () => {
    const { app, receiver } = createTestApp(config);
    await postHook(app, makeEvent('SessionStart'));
    const result = await postHook(app, makeEvent('PreToolUse'));

    expect(result.data.state).toBe('working');
    receiver.cleanup();
  });

  test('resolves dominant state across multiple sessions', async () => {
    const { app, receiver } = createTestApp(config);
    await postHook(app, makeEvent('SessionStart', 'sess-1'));
    await postHook(app, makeEvent('UserPromptSubmit', 'sess-1'));
    await postHook(app, makeEvent('SessionStart', 'sess-2'));
    await postHook(app, makeEvent('PreToolUse', 'sess-2'));

    expect(receiver.getResolvedState()).toBe('working');
    receiver.cleanup();
  });

  test('broadcasts task_event on state change', async () => {
    const { app, receiver, messages } = createTestApp(config);
    await postHook(app, makeEvent('SessionStart'));
    await postHook(app, makeEvent('UserPromptSubmit'));

    const taskEvents = messages.filter(m => m.type === 'task_event');
    expect(taskEvents.length).toBeGreaterThanOrEqual(2);
    receiver.cleanup();
  });

  test('handles SubagentStart/SubagentStop resume', async () => {
    const { app, receiver } = createTestApp(config);
    await postHook(app, makeEvent('SessionStart'));
    await postHook(app, makeEvent('PreToolUse'));
    await postHook(app, makeEvent('SubagentStart'));

    expect(receiver.getResolvedState()).toBe('juggling');

    await postHook(app, makeEvent('SubagentStop'));
    expect(receiver.getResolvedState()).toBe('working');
    receiver.cleanup();
  });

  test('SessionEnd removes session', async () => {
    const { app, receiver } = createTestApp(config);
    await postHook(app, makeEvent('SessionStart'));
    await postHook(app, makeEvent('PreToolUse'));
    await postHook(app, makeEvent('SessionEnd'));

    expect(receiver.getResolvedState()).toBe('idle');
    expect(Object.keys(receiver.getSessions())).toHaveLength(0);
    receiver.cleanup();
  });
});

// --- Edge/Error Cases (≥30%) ---

describe('Hook Receiver - edge cases', () => {
  test('rejects invalid event type', async () => {
    const { app, receiver } = createTestApp(makeConfig());
    const result = await postHook(app, {
      event: 'NonExistentEvent',
      timestamp: new Date().toISOString()
    });

    expect(result.status).toBe(400);
    receiver.cleanup();
  });

  test('rejects missing event field', async () => {
    const { app, receiver } = createTestApp(makeConfig());
    const result = await postHook(app, {
      sessionId: 'test',
      timestamp: new Date().toISOString()
    });

    expect(result.status).toBe(400);
    receiver.cleanup();
  });

  test('returns 401 when hookSecret set and no auth header', async () => {
    const { app, receiver } = createTestApp(makeConfig({ hookSecret: 'my-secret' }));
    const result = await postHook(app, makeEvent('SessionStart'));

    expect(result.status).toBe(401);
    receiver.cleanup();
  });

  test('returns 401 when hookSecret set and wrong auth', async () => {
    const { app, receiver } = createTestApp(makeConfig({ hookSecret: 'my-secret' }));
    const result = await postHook(app, makeEvent('SessionStart'), {
      Authorization: 'Bearer wrong-secret'
    });

    expect(result.status).toBe(401);
    receiver.cleanup();
  });

  test('accepts request with correct hookSecret', async () => {
    const { app, receiver } = createTestApp(makeConfig({ hookSecret: 'my-secret' }));
    const result = await postHook(app, makeEvent('SessionStart'), {
      Authorization: 'Bearer my-secret'
    });

    expect(result.status).toBe(200);
    receiver.cleanup();
  });

  test('assigns default sessionId when missing', async () => {
    const { app, receiver } = createTestApp(makeConfig());
    const result = await postHook(app, {
      event: 'SessionStart',
      timestamp: new Date().toISOString()
    });

    expect(result.status).toBe(200);
    const sessions = receiver.getSessions();
    expect(sessions['default']).toBeDefined();
    receiver.cleanup();
  });

  test('juggling holds through working and thinking events', async () => {
    const { app, receiver } = createTestApp(makeConfig());
    await postHook(app, makeEvent('SessionStart'));
    await postHook(app, makeEvent('SubagentStart'));

    expect(receiver.getResolvedState()).toBe('juggling');

    await postHook(app, makeEvent('PreToolUse'));
    expect(receiver.getResolvedState()).toBe('juggling');

    await postHook(app, makeEvent('PostToolUse'));
    expect(receiver.getResolvedState()).toBe('juggling');

    await postHook(app, makeEvent('UserPromptSubmit'));
    expect(receiver.getResolvedState()).toBe('juggling');
    receiver.cleanup();
  });

  test('sleep timeout fires after all sessions end', async () => {
    const { app, receiver, messages } = createTestApp(makeConfig({ sleepTimeoutMs: 100 }));
    await postHook(app, makeEvent('SessionStart'));
    await postHook(app, makeEvent('SessionEnd'));

    await new Promise((r) => setTimeout(r, 200));

    const sleepMsgs = messages.filter(m =>
      m.type === 'task_event' && m.data.event === 'SleepTimeout'
    );
    expect(sleepMsgs.length).toBeGreaterThanOrEqual(1);
    expect(sleepMsgs[0].data.resolvedState).toBe('sleeping');
    receiver.cleanup();
  });

  test('oneshot state auto-returns', async () => {
    const { app, receiver, messages } = createTestApp(makeConfig({ oneshotDurationMs: 100 }));
    await postHook(app, makeEvent('SessionStart'));
    await postHook(app, makeEvent('PostToolUseFailure'));

    const afterError = messages.filter(m =>
      m.type === 'task_event' && m.data.resolvedState === 'error'
    );
    expect(afterError.length).toBeGreaterThanOrEqual(1);

    await new Promise((r) => setTimeout(r, 200));

    const returnMsgs = messages.filter(m =>
      m.type === 'task_event' && m.data.event === 'OneshotReturn'
    );
    expect(returnMsgs.length).toBeGreaterThanOrEqual(1);
    receiver.cleanup();
  });

  test('getSessions returns copy of session data', async () => {
    const { app, receiver } = createTestApp(makeConfig());
    await postHook(app, makeEvent('SessionStart'));
    await postHook(app, makeEvent('PreToolUse'));

    const sessions = receiver.getSessions();
    sessions['session-1'].state = 'hacked';

    expect(receiver.getResolvedState()).toBe('working');
    receiver.cleanup();
  });
});

// --- Adversarial Cases (≥20%) ---

describe('Hook Receiver - adversarial', () => {
  test('handles rapid events from many sessions', async () => {
    const { app, receiver } = createTestApp(makeConfig());

    const events = [];
    for (let i = 0; i < 10; i++) {
      events.push(postHook(app, makeEvent('SessionStart', `sess-${i}`)));
    }
    await Promise.all(events);

    expect(Object.keys(receiver.getSessions())).toHaveLength(10);
    receiver.cleanup();
  });

  test('PostToolUseFailure is oneshot, does not persist in session', async () => {
    const { app, receiver } = createTestApp(makeConfig());
    await postHook(app, makeEvent('SessionStart'));
    await postHook(app, makeEvent('PreToolUse'));
    await postHook(app, makeEvent('PostToolUseFailure'));

    const sessions = receiver.getSessions();
    expect(sessions['session-1'].state).toBe('working');
    receiver.cleanup();
  });

  test('Stop event is oneshot attention, not persistent', async () => {
    const { app, receiver } = createTestApp(makeConfig());
    await postHook(app, makeEvent('SessionStart'));
    await postHook(app, makeEvent('PreToolUse'));
    await postHook(app, makeEvent('Stop'));

    const sessions = receiver.getSessions();
    expect(sessions['session-1'].state).toBe('working');
    receiver.cleanup();
  });

  test('SessionEnd then new SessionStart works', async () => {
    const { app, receiver } = createTestApp(makeConfig());
    await postHook(app, makeEvent('SessionStart'));
    await postHook(app, makeEvent('SessionEnd'));
    expect(Object.keys(receiver.getSessions())).toHaveLength(0);

    await postHook(app, makeEvent('SessionStart'));
    expect(Object.keys(receiver.getSessions())).toHaveLength(1);
    expect(receiver.getResolvedState()).toBe('idle');
    receiver.cleanup();
  });

  test('cleanup clears all timers and sessions', async () => {
    const { app, receiver } = createTestApp(makeConfig());
    await postHook(app, makeEvent('SessionStart'));
    await postHook(app, makeEvent('PostToolUseFailure'));

    receiver.cleanup();
    expect(Object.keys(receiver.getSessions())).toHaveLength(0);
    expect(receiver.getResolvedState()).toBe('idle');
  });

  test('SubagentStop without prior SubagentStart uses default behavior', async () => {
    const { app, receiver } = createTestApp(makeConfig());
    await postHook(app, makeEvent('SessionStart'));
    await postHook(app, makeEvent('SubagentStop'));

    expect(receiver.getResolvedState()).toBe('working');
    receiver.cleanup();
  });

  test('rejects oversized request body (>1MB)', async () => {
    const { app, receiver } = createTestApp(makeConfig());
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const bigPayload = JSON.stringify({
      event: 'SessionStart',
      timestamp: new Date().toISOString(),
      padding: 'x'.repeat(1024 * 1024 + 1)
    });

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/hook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bigPayload
      });
      expect(res.status).toBe(413);
    } finally {
      receiver.cleanup();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('stale cleanup removes sessions older than 600s', async () => {
    const { app, receiver } = createTestApp(makeConfig());
    const baseTime = new Date('2025-06-01T00:00:00Z').getTime();

    vi.useFakeTimers({ now: baseTime });
    await postHook(app, makeEvent('SessionStart'));
    await postHook(app, makeEvent('PreToolUse'));
    expect(Object.keys(receiver.getSessions())).toHaveLength(1);

    vi.setSystemTime(baseTime + 601000);
    receiver._cleanStaleSessions();

    expect(Object.keys(receiver.getSessions())).toHaveLength(0);
    expect(receiver.getResolvedState()).toBe('idle');
    vi.useRealTimers();
    receiver.cleanup();
  });

  test('stale cleanup demotes working sessions stuck >300s to idle', async () => {
    const { app, receiver } = createTestApp(makeConfig());
    const baseTime = new Date('2025-06-01T00:00:00Z').getTime();

    vi.useFakeTimers({ now: baseTime });
    await postHook(app, makeEvent('SessionStart'));
    await postHook(app, makeEvent('PreToolUse'));
    expect(receiver.getResolvedState()).toBe('working');

    vi.setSystemTime(baseTime + 301000);
    receiver._cleanStaleSessions();

    expect(Object.keys(receiver.getSessions())).toHaveLength(1);
    expect(receiver.getResolvedState()).toBe('idle');
    vi.useRealTimers();
    receiver.cleanup();
  });
});
