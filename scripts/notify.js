'use strict';

const http = require('http');
const { URL } = require('url');
const path = require('path');
const fs = require('fs');
const os = require('os');

const TIMEOUT_MS = 2000;
const STDIN_TIMEOUT_MS = 400;

function getConfigPath() {
  const configDir = process.env.CLAWD_PHONE_CONFIG_DIR
    || path.join(os.homedir(), '.clawd-phone');
  return path.join(configDir, 'config.json');
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function getServerUrl(config) {
  const host = (config.host === '0.0.0.0' ? '127.0.0.1' : config.host) || '127.0.0.1';
  const port = config.port || 9870;
  return `http://${host}:${port}`;
}

function getHookSecret(config) {
  return config.hookSecret || '';
}

function readStdinJson() {
  return new Promise((resolve) => {
    const chunks = [];
    let done = false;
    let timer = null;

    const onData = (c) => chunks.push(c);

    function finish() {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      process.stdin.off('data', onData);
      process.stdin.off('end', finish);
      let payload = {};
      try {
        const raw = Buffer.concat(chunks).toString();
        if (raw.trim()) payload = JSON.parse(raw);
      } catch {
        // ignore parse errors — return empty object
      }
      resolve(payload);
    }

    process.stdin.on('data', onData);
    process.stdin.on('end', finish);
    timer = setTimeout(finish, STDIN_TIMEOUT_MS);
  });
}

function buildBody(event, stdinData) {
  const { session_id, cwd, ...rest } = stdinData;
  return {
    ...rest,
    event,
    sessionId: session_id || undefined,
    cwd: cwd || undefined,
    timestamp: new Date().toISOString()
  };
}

function postToServer(serverUrl, body, secret) {
  return new Promise((resolve) => {
    const url = new URL('/api/hook', serverUrl);
    const data = JSON.stringify(body);

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    };
    if (secret) {
      headers['Authorization'] = `Bearer ${secret}`;
    }

    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers,
      timeout: TIMEOUT_MS
    }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });

    req.on('error', () => resolve(0));
    req.on('timeout', () => {
      req.destroy();
      resolve(0);
    });

    req.write(data);
    req.end();
  });
}

async function main() {
  const event = process.argv[2];
  if (!event) {
    process.exit(0);
  }

  const stdinData = await readStdinJson();
  const body = buildBody(event, stdinData);
  const config = loadConfig();
  const serverUrl = getServerUrl(config);
  const secret = getHookSecret(config);
  await postToServer(serverUrl, body, secret);
  process.exit(0);
}

if (require.main === module) {
  main().catch(() => process.exit(0));
}

module.exports = {
  TIMEOUT_MS,
  STDIN_TIMEOUT_MS,
  getConfigPath,
  loadConfig,
  getServerUrl,
  getHookSecret,
  readStdinJson,
  buildBody,
  postToServer
};
