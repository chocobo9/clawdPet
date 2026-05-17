'use strict';

const http = require('http');
const express = require('express');
const path = require('path');
const { loadConfig } = require('./config.js');
const { createWebSocketHub } = require('./websocket-hub.js');
const { createHookReceiver } = require('./hook-receiver.js');
const { createUsagePoller } = require('./usage-poller.js');
const { createSpriteManager } = require('./sprite-manager.js');

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
});

function shutdown() {
  console.log('[clawd-pet] Shutting down...');
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
