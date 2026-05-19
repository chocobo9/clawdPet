'use strict';

const http = require('http');
const express = require('express');
const path = require('path');
const { loadConfig } = require('./config.js');
const { createWebSocketHub } = require('./websocket-hub.js');
const { createHookReceiver } = require('./hook-receiver.js');
const { createUsagePoller } = require('./usage-poller.js');
const { createSpriteManager } = require('./sprite-manager.js');
const { createProcessDetector } = require('./process-detector.js');

const config = loadConfig();

const app = express();
const server = http.createServer(app);

const wsHub = createWebSocketHub(server);

const hookReceiver = createHookReceiver({
  config,
  broadcast: wsHub.broadcast
});

const usagePoller = createUsagePoller({
  config,
  broadcast: wsHub.broadcast
});

const spriteManager = createSpriteManager({
  skinsDir: path.join(__dirname, '..', 'skins')
});

const processDetector = createProcessDetector({
  injectEvent: hookReceiver.injectEvent,
  getSessions: hookReceiver.getSessions
});

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

const rateLimitCounts = new Map();
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX = 120;

function rateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const entry = rateLimitCounts.get(ip);
  if (!entry || now - entry.start > RATE_LIMIT_WINDOW) {
    rateLimitCounts.set(ip, { start: now, count: 1 });
    return next();
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    res.status(429).json({ error: 'Too many requests' });
    return;
  }
  next();
}

app.use('/api/hook', rateLimit);
app.use('/api/skins/upload', rateLimit);

app.use(hookReceiver.router);
app.use(spriteManager.router);

app.use(express.static(path.join(__dirname, '..', 'static')));

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    wsClients: wsHub.getClientCount(),
    petState: hookReceiver.getResolvedState(),
    pollerStatus: usagePoller.getStatus()
  });
});

app.get('/api/sessions', (_req, res) => {
  res.json({
    sessions: hookReceiver.getSessions(),
    resolvedState: hookReceiver.getResolvedState()
  });
});

server.listen(config.port, config.host, () => {
  console.log(`[clawd-pet] Server listening on ${config.host}:${config.port}`);
  usagePoller.start();
  processDetector.start();
});

function shutdown() {
  console.log('[clawd-pet] Shutting down...');
  processDetector.stop();
  usagePoller.stop();
  hookReceiver.cleanup();
  wsHub.cleanup();
  server.close(() => {
    console.log('[clawd-pet] Server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { app, server };
