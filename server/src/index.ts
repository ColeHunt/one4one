import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { getDb } from './db.js';
import { attachHub } from './hub.js';
import { isValidRoomCode, normaliseRoomCode } from './ids.js';
import { createRoom, purgeStaleRooms, roomExists } from './rooms.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The compiled server lives at dist/server/src, so the built client is four
 * levels up in production and two in dev.
 */
function findWebDist(): string | null {
  const candidates = [
    path.resolve(here, '../../../../web/dist'),
    path.resolve(here, '../../web/dist'),
  ];
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'index.html'))) ?? null;
}

export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '16kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/rooms', (_req, res) => {
    const code = createRoom();
    res.status(201).json({ code });
  });

  app.get('/api/rooms/:code', (req, res) => {
    const code = normaliseRoomCode(req.params.code ?? '');
    if (!isValidRoomCode(code) || !roomExists(code)) {
      res.status(404).json({ error: 'room_not_found' });
      return;
    }
    res.json({ code });
  });

  const webDist = findWebDist();
  if (webDist) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    // SPA fallback: every non-API path renders the client, which routes on /r/:code.
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  return app;
}

function start(): void {
  getDb();
  const app = createApp();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: config.maxMessageBytes });
  const stopHeartbeat = attachHub(wss);

  const purged = purgeStaleRooms();
  if (purged > 0) console.log(`purged ${purged} stale room(s) on boot`);
  const cleanup = setInterval(() => {
    const count = purgeStaleRooms();
    if (count > 0) console.log(`purged ${count} stale room(s)`);
  }, 60 * 60_000);

  server.listen(config.port, () => {
    console.log(`one4one listening on http://localhost:${config.port}`);
    console.log(`data dir: ${config.dataDir}`);
  });

  const shutdown = () => {
    stopHeartbeat();
    clearInterval(cleanup);
    wss.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Only boot when run directly, so tests can import the app without a listener.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  start();
}
