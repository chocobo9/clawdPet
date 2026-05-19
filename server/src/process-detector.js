'use strict';

const { exec } = require('child_process');
const { AGENT_TYPES } = require('./models.js');

const DEFAULT_POLL_MS = 15000;

const PROCESS_NAMES = Object.freeze({
  claude:   { win: 'claude',   unix: 'claude' },
  codex:    { win: 'codex',    unix: 'codex' },
  cursor:   { win: 'Cursor',   unix: 'cursor' },
  gemini:   { win: 'gemini',   unix: 'gemini' },
  windsurf: { win: 'Windsurf', unix: 'windsurf' }
});

function createProcessDetector({ injectEvent, getSessions, pollMs }) {
  const interval = pollMs || DEFAULT_POLL_MS;
  const tracked = new Map();
  let timer = null;
  let running = false;

  function poll() {
    if (!running) return;

    const allSessions = getSessions();
    const hookSessionCount = Object.keys(allSessions)
      .filter(id => !id.startsWith('process-')).length;

    if (hookSessionCount > 0) {
      if (tracked.size > 0) {
        for (const [pid] of tracked) {
          injectEvent({ event: 'SessionEnd', sessionId: `process-${pid}` });
        }
        tracked.clear();
      }
      return;
    }

    detectProcesses((results) => {
      reconcile(results);
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
    const names = AGENT_TYPES.map(t => PROCESS_NAMES[t].win).join(',');
    const cmd = `powershell -NoProfile -Command "Get-Process -Name ${names} -ErrorAction SilentlyContinue | Select-Object Id,ProcessName | ConvertTo-Json -Compress"`;
    exec(cmd, { timeout: 8000 }, (err, stdout) => {
      if (err || !stdout.trim()) return callback([]);
      callback(parseGetProcess(stdout));
    });
  }

  function detectUnix(callback) {
    const pattern = AGENT_TYPES.map(t => PROCESS_NAMES[t].unix).join('|');
    exec(
      `ps -eo pid,comm 2>/dev/null | awk '$2 ~ /^(${pattern})$/ {print $1,$2}' || true`,
      { timeout: 5000 },
      (err, stdout) => {
        if (err) return callback([]);
        const results = [];
        for (const line of stdout.trim().split('\n')) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 2) {
            const agent = resolveAgentType(parts[1], 'unix');
            if (agent) results.push({ pid: parts[0], agentType: agent });
          }
        }
        callback(results);
      }
    );
  }

  function parseGetProcess(stdout) {
    try {
      const raw = JSON.parse(stdout);
      const arr = Array.isArray(raw) ? raw : [raw];
      return arr
        .filter(p => p && p.Id)
        .map(p => ({
          pid: String(p.Id),
          agentType: resolveAgentType(p.ProcessName, 'win')
        }))
        .filter(p => p.agentType);
    } catch {
      return [];
    }
  }

  function resolveAgentType(processName, platform) {
    const key = platform === 'win' ? 'win' : 'unix';
    const lower = (processName || '').toLowerCase();
    for (const agent of AGENT_TYPES) {
      if (PROCESS_NAMES[agent][key].toLowerCase() === lower) return agent;
    }
    return null;
  }

  function reconcile(liveResults) {
    const liveMap = new Map(liveResults.map(r => [r.pid, r.agentType]));

    for (const [pid] of tracked) {
      if (!liveMap.has(pid)) {
        tracked.delete(pid);
        injectEvent({ event: 'SessionEnd', sessionId: `process-${pid}` });
      }
    }

    for (const { pid, agentType } of liveResults) {
      if (!tracked.has(pid)) {
        tracked.set(pid, agentType);
        injectEvent({
          event: 'SessionStart',
          sessionId: `process-${pid}`,
          agentType
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
    tracked.clear();
  }

  function getTrackedPids() {
    return [...tracked.entries()].map(([pid, agentType]) => ({ pid, agentType }));
  }

  return { start, stop, getTrackedPids, _poll: poll, _parseGetProcess: parseGetProcess, _resolveAgentType: resolveAgentType };
}

module.exports = { createProcessDetector, PROCESS_NAMES };
