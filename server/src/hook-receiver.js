'use strict';

const express = require('express');
const {
  EVENT_TO_STATE,
  STATE_PRIORITY,
  ONESHOT_STATES,
  TaskEventSchema
} = require('./models.js');

const SESSION_STALE_MS = 600000;
const WORKING_STALE_MS = 300000;
const STALE_CLEANUP_INTERVAL_MS = 60000;

function createHookReceiver({ config, broadcast }) {
  const sessions = new Map();
  const oneshotTimers = new Map();
  let sleepTimer = null;

  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));

  router.post('/api/hook', (req, res) => {
    if (config.hookSecret) {
      const auth = req.headers.authorization;
      if (!auth || auth !== `Bearer ${config.hookSecret}`) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
    }

    let parsed;
    try {
      parsed = TaskEventSchema.parse({
        ...req.body,
        timestamp: req.body.timestamp || new Date().toISOString()
      });
    } catch (err) {
      res.status(400).json({ error: 'Invalid event payload' });
      return;
    }

    const sessionId = parsed.sessionId || 'default';
    const targetState = EVENT_TO_STATE[parsed.event];

    if (!targetState) {
      res.status(400).json({ error: `Unknown event: ${parsed.event}` });
      return;
    }

    processEvent(parsed.event, targetState, sessionId, parsed);
    res.json({ state: getResolvedState() });
  });

  function processEvent(event, targetState, sessionId, eventData) {
    const now = Date.now();

    if (event === 'SessionEnd') {
      sessions.delete(sessionId);
      clearOneshotTimer(sessionId);
      broadcastStateChange(eventData);
      scheduleSleepIfIdle();
      return;
    }

    cancelSleepTimer();

    const existing = sessions.get(sessionId);

    if (event === 'SubagentStart' && existing) {
      sessions.set(sessionId, {
        ...existing,
        state: targetState,
        updatedAt: now,
        resumeState: existing.state,
        cwd: eventData.cwd || existing.cwd
      });
      broadcastStateChange(eventData);
      return;
    }

    if (event === 'SubagentStop' && existing && existing.resumeState) {
      sessions.set(sessionId, {
        ...existing,
        state: existing.resumeState,
        updatedAt: now,
        resumeState: null
      });
      broadcastStateChange(eventData);
      return;
    }

    if (existing && existing.state === 'juggling'
        && (targetState === 'working' || targetState === 'thinking')) {
      sessions.set(sessionId, { ...existing, updatedAt: now });
      return;
    }

    if (ONESHOT_STATES.includes(targetState)) {
      sessions.set(sessionId, {
        state: existing ? existing.state : 'idle',
        updatedAt: now,
        cwd: eventData.cwd || (existing && existing.cwd) || null,
        resumeState: existing ? existing.resumeState : null
      });

      broadcastOneshotState(targetState, eventData);
      scheduleOneshotReturn(sessionId);
      return;
    }

    sessions.set(sessionId, {
      state: targetState,
      updatedAt: now,
      cwd: eventData.cwd || (existing && existing.cwd) || null,
      resumeState: existing ? existing.resumeState : null
    });

    broadcastStateChange(eventData);
  }

  function resolveDominantState() {
    if (sessions.size === 0) return 'idle';

    let dominant = 'idle';
    let highestPriority = -1;

    for (const [, session] of sessions) {
      const priority = STATE_PRIORITY[session.state] || 0;
      if (priority > highestPriority) {
        highestPriority = priority;
        dominant = session.state;
      }
    }

    return dominant;
  }

  function broadcastStateChange(eventData) {
    broadcast({
      type: 'task_event',
      data: {
        event: eventData.event,
        sessionId: eventData.sessionId,
        timestamp: eventData.timestamp,
        resolvedState: getResolvedState()
      }
    });
  }

  function broadcastOneshotState(state, eventData) {
    broadcast({
      type: 'task_event',
      data: {
        event: eventData.event,
        sessionId: eventData.sessionId,
        timestamp: eventData.timestamp,
        resolvedState: state
      }
    });
  }

  function scheduleOneshotReturn(sessionId) {
    clearOneshotTimer(sessionId);
    const timer = setTimeout(() => {
      oneshotTimers.delete(sessionId);
      broadcast({
        type: 'task_event',
        data: {
          event: 'OneshotReturn',
          timestamp: new Date().toISOString(),
          resolvedState: getResolvedState()
        }
      });
    }, config.oneshotDurationMs || 5000);
    oneshotTimers.set(sessionId, timer);
  }

  function clearOneshotTimer(sessionId) {
    const timer = oneshotTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      oneshotTimers.delete(sessionId);
    }
  }

  function scheduleSleepIfIdle() {
    if (sessions.size > 0) return;
    cancelSleepTimer();
    sleepTimer = setTimeout(() => {
      sleepTimer = null;
      broadcast({
        type: 'task_event',
        data: {
          event: 'SleepTimeout',
          timestamp: new Date().toISOString(),
          resolvedState: 'sleeping'
        }
      });
    }, config.sleepTimeoutMs || 120000);
  }

  function cancelSleepTimer() {
    if (sleepTimer) {
      clearTimeout(sleepTimer);
      sleepTimer = null;
    }
  }

  function cleanStaleSessions() {
    const now = Date.now();
    for (const [id, session] of sessions) {
      const elapsed = now - session.updatedAt;
      if (elapsed > SESSION_STALE_MS) {
        sessions.delete(id);
        clearOneshotTimer(id);
        continue;
      }
      if (session.state === 'working' && elapsed > WORKING_STALE_MS) {
        sessions.set(id, { ...session, state: 'idle', updatedAt: now });
      }
    }
  }

  const staleCleanupInterval = setInterval(cleanStaleSessions, STALE_CLEANUP_INTERVAL_MS);

  function getResolvedState() {
    return resolveDominantState();
  }

  function getSessions() {
    const result = {};
    for (const [id, session] of sessions) {
      result[id] = { ...session };
    }
    return result;
  }

  function cleanup() {
    clearInterval(staleCleanupInterval);
    cancelSleepTimer();
    for (const timer of oneshotTimers.values()) {
      clearTimeout(timer);
    }
    oneshotTimers.clear();
    sessions.clear();
  }

  return { router, getResolvedState, getSessions, cleanup, _cleanStaleSessions: cleanStaleSessions };
}

module.exports = { createHookReceiver };
