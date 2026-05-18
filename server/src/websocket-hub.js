'use strict';

const { WebSocketServer, WebSocket } = require('ws');
const { URL } = require('url');
const { WsMessageSchema } = require('./models.js');

const DEFAULT_HEARTBEAT_MS = 30000;
const WS_PATH = '/ws';
const MAX_PAYLOAD = 1024 * 1024;

function createWebSocketHub(httpServer, options = {}) {
  const heartbeatMs = options.heartbeatMs || DEFAULT_HEARTBEAT_MS;
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_PAYLOAD
  });

  let lastUsageUpdate = null;

  httpServer.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);
    if (pathname !== WS_PATH) {
      socket.destroy();
      return;
    }

    const origin = req.headers.origin;
    if (origin) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== req.headers.host) {
          console.warn(`[ws-hub] Rejected cross-origin WS from: ${origin}`);
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }
      } catch {
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    if (lastUsageUpdate) {
      sendJson(ws, lastUsageUpdate);
    }

    ws.on('error', (err) => {
      console.error('[ws-hub] client error:', err.message);
    });
  });

  const heartbeatInterval = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, heartbeatMs);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  function sendJson(ws, payload) {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
  }

  function broadcast(message) {
    const parsed = WsMessageSchema.parse(message);

    if (parsed.type === 'usage_update') {
      lastUsageUpdate = parsed;
    }

    const serialized = JSON.stringify(parsed);
    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      client.send(serialized);
    }
  }

  function getClientCount() {
    return wss.clients.size;
  }

  function getLastUsageUpdate() {
    return lastUsageUpdate;
  }

  function cleanup() {
    clearInterval(heartbeatInterval);
    for (const client of wss.clients) {
      client.terminate();
    }
    wss.close();
  }

  return {
    wss,
    broadcast,
    getClientCount,
    getLastUsageUpdate,
    cleanup
  };
}

module.exports = { createWebSocketHub };
