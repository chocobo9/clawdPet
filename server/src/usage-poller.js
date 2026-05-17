'use strict';

const https = require('https');
const fs = require('fs');
const { UsageApiResponseSchema } = require('./models.js');
const { expandTilde } = require('./config.js');

const API_HOSTNAME = 'api.anthropic.com';
const API_PATH = '/api/oauth/usage';
const API_BETA_HEADER = 'oauth-2025-04-20';
const REQUEST_TIMEOUT_MS = 10000;
const MAX_BACKOFF_MS = 300000;

function readToken(credentialsPath) {
  const resolvedPath = expandTilde(credentialsPath);

  if (!fs.existsSync(resolvedPath)) {
    return { token: null, error: 'no-credentials' };
  }

  try {
    const raw = fs.readFileSync(resolvedPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const token = parsed?.claudeAiOauth?.accessToken ?? null;

    if (!token) {
      return { token: null, error: 'no-credentials' };
    }

    return { token, error: null };
  } catch {
    return { token: null, error: 'parse-error' };
  }
}

function maskToken(token) {
  if (!token || token.length < 8) return '***';
  return token.substring(0, 8) + '...';
}

function fetchUsageFromApi(token) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    const req = https.request({
      hostname: API_HOSTNAME,
      path: API_PATH,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'anthropic-beta': API_BETA_HEADER,
        'Accept': 'application/json'
      },
      timeout: REQUEST_TIMEOUT_MS
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('error', (err) => {
        finish({ kind: 'error', message: `Response stream error: ${err.message}` });
      });
      res.on('end', () => {
        if (res.statusCode === 200) {
          finish({ kind: 'success', body: data });
        } else if (res.statusCode === 429) {
          const retryAfter = parseRetryAfterSeconds(res.headers['retry-after']);
          finish({ kind: 'rate-limited', retryAfterSeconds: retryAfter });
        } else if (res.statusCode === 401) {
          finish({ kind: 'error', message: 'Token expired or invalid', status: 401 });
        } else {
          finish({ kind: 'error', message: `API returned ${res.statusCode}`, status: res.statusCode });
        }
      });
    });

    req.on('error', (err) => {
      finish({ kind: 'error', message: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      finish({ kind: 'timeout' });
    });

    req.end();
  });
}

function parseRetryAfterSeconds(headerValue) {
  if (!headerValue) return 60;
  const parsed = parseInt(headerValue, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
}

function transformApiResponse(rawJson) {
  const parsed = JSON.parse(rawJson);
  const validated = UsageApiResponseSchema.parse(parsed);

  return {
    sessionUsage: validated.five_hour?.utilization ?? null,
    sessionResetAt: validated.five_hour?.resets_at ?? null,
    weeklyUsage: validated.seven_day?.utilization ?? null,
    weeklyResetAt: validated.seven_day?.resets_at ?? null,
    weeklySonnetUsage: validated.seven_day_sonnet?.utilization ?? null,
    weeklySonnetResetAt: validated.seven_day_sonnet?.resets_at ?? null,
    weeklyOpusUsage: validated.seven_day_opus?.utilization ?? null,
    weeklyOpusResetAt: validated.seven_day_opus?.resets_at ?? null,
    extraUsageEnabled: validated.extra_usage?.is_enabled,
    extraUsageLimit: validated.extra_usage?.monthly_limit,
    extraUsageUsed: validated.extra_usage?.used_credits,
    extraUsageUtilization: validated.extra_usage?.utilization,
    error: null,
    lastUpdatedAt: new Date().toISOString()
  };
}

function createUsagePoller({ config, broadcast }) {
  const baseIntervalMs = (config.pollIntervalSeconds || 60) * 1000;
  let currentIntervalMs = baseIntervalMs;
  let consecutiveErrors = 0;
  let pollTimer = null;
  let isRunning = false;

  async function poll() {
    const { token, error: tokenError } = readToken(config.claudeCredentialsPath);

    if (tokenError) {
      console.error(`[usage-poller] Token error: ${tokenError}`);
      broadcastError(tokenError);
      scheduleNextPoll(true);
      return;
    }

    console.log(`[usage-poller] Polling with token ${maskToken(token)}`);

    const result = await fetchUsageFromApi(token);

    if (result.kind === 'success') {
      try {
        const usageData = transformApiResponse(result.body);
        broadcast({
          type: 'usage_update',
          data: usageData
        });
        consecutiveErrors = 0;
        currentIntervalMs = baseIntervalMs;
        scheduleNextPoll(false);
      } catch (err) {
        console.error(`[usage-poller] Parse error: ${err.message}`);
        broadcastError('parse-error');
        scheduleNextPoll(true);
      }
    } else if (result.kind === 'rate-limited') {
      const waitMs = (result.retryAfterSeconds || 60) * 1000;
      console.error(`[usage-poller] Rate limited, retry after ${result.retryAfterSeconds}s`);
      broadcastError('rate-limited');
      consecutiveErrors++;
      currentIntervalMs = Math.max(waitMs, currentIntervalMs);
      scheduleNextPoll(false);
    } else if (result.kind === 'timeout') {
      console.error('[usage-poller] Request timed out');
      broadcastError('timeout');
      scheduleNextPoll(true);
    } else {
      console.error(`[usage-poller] API error: ${result.message}`);
      broadcastError('api-error');
      scheduleNextPoll(true);
    }
  }

  function broadcastError(errorType) {
    broadcast({
      type: 'usage_update',
      data: {
        sessionUsage: null,
        sessionResetAt: null,
        weeklyUsage: null,
        weeklyResetAt: null,
        error: errorType,
        lastUpdatedAt: new Date().toISOString()
      }
    });
  }

  function scheduleNextPoll(isError) {
    if (!isRunning) return;

    if (isError) {
      consecutiveErrors++;
      currentIntervalMs = Math.min(currentIntervalMs * 2, MAX_BACKOFF_MS);
    }

    clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, currentIntervalMs);
  }

  function start() {
    if (isRunning) return;
    isRunning = true;
    poll();
  }

  function stop() {
    isRunning = false;
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  function pollNow() {
    return poll();
  }

  function getStatus() {
    return {
      isRunning,
      consecutiveErrors,
      currentIntervalMs
    };
  }

  return { start, stop, pollNow, getStatus };
}

module.exports = {
  createUsagePoller,
  readToken,
  maskToken,
  fetchUsageFromApi,
  transformApiResponse,
  parseRetryAfterSeconds
};
