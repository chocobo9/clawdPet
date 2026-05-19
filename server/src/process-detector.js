'use strict';

const { exec } = require('child_process');

const DEFAULT_POLL_MS = 15000;

function createProcessDetector({ injectEvent, getSessions, pollMs }) {
  const interval = pollMs || DEFAULT_POLL_MS;
  const trackedPids = new Set();
  let timer = null;
  let running = false;

  function poll() {
    if (!running) return;

    const allSessions = getSessions();
    const hookSessionCount = Object.keys(allSessions)
      .filter(id => !id.startsWith('process-')).length;

    if (hookSessionCount > 0) {
      if (trackedPids.size > 0) {
        for (const pid of trackedPids) {
          injectEvent({
            event: 'SessionEnd',
            sessionId: `process-${pid}`
          });
        }
        trackedPids.clear();
      }
      return;
    }

    detectProcesses((pids) => {
      reconcile(pids);
    });
  }

  function detectProcesses(callback) {
    if (process.platform === 'win32') {
      detectWindows(callback);
    } else {
      detectUnix(callback);
    }
  }

  function detectWindows(callback) {
    exec(
      'tasklist /FI "IMAGENAME eq claude.exe" /FO CSV /NH',
      { timeout: 5000 },
      (err, stdout) => {
        if (err) return callback([]);
        callback(parseTasklistCsv(stdout));
      }
    );
  }

  function detectUnix(callback) {
    exec(
      'pgrep -x claude 2>/dev/null || true',
      { timeout: 5000 },
      (err, stdout) => {
        if (err) return callback([]);
        callback(stdout.trim().split('\n').filter(Boolean));
      }
    );
  }

  function parseTasklistCsv(stdout) {
    const pids = [];
    for (const line of stdout.split('\n')) {
      const match = line.match(/"claude\.exe"\s*,\s*"(\d+)"/i);
      if (match) pids.push(match[1]);
    }
    return pids;
  }

  function reconcile(livePids) {
    const liveSet = new Set(livePids);

    for (const pid of trackedPids) {
      if (!liveSet.has(pid)) {
        trackedPids.delete(pid);
        injectEvent({
          event: 'SessionEnd',
          sessionId: `process-${pid}`
        });
      }
    }

    for (const pid of livePids) {
      if (!trackedPids.has(pid)) {
        trackedPids.add(pid);
        injectEvent({
          event: 'SessionStart',
          sessionId: `process-${pid}`
        });
      }
    }
  }

  function start() {
    if (running) return;
    running = true;
    poll();
    timer = setInterval(poll, interval);
  }

  function stop() {
    running = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    trackedPids.clear();
  }

  function getTrackedPids() {
    return [...trackedPids];
  }

  return { start, stop, getTrackedPids, _poll: poll, _parseTasklistCsv: parseTasklistCsv };
}

module.exports = { createProcessDetector };
