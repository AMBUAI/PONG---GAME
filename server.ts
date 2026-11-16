import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomManager } from './src/server/roomManager.ts';
import type { ClientToServerMessage } from './src/shared/pongTypes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  const roomManager = new RoomManager();

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg: ClientToServerMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientToServerMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case 'create_room':
          roomManager.createRoom(ws);
          break;
        case 'join_room':
          roomManager.joinRoom(ws, msg.roomCode);
          break;
        case 'reconnect_room':
          roomManager.reconnectRoom(ws, msg.roomCode, msg.playerToken);
          break;
        case 'set_series_length':
          roomManager.setSeriesLength(ws, msg.seriesLength);
          break;
        case 'start_match':
          roomManager.startMatch(ws);
          break;
        case 'paddle_input':
          roomManager.handlePaddleInput(ws, msg.targetV, msg.moveDir);
          break;
        case 'request_rematch':
          roomManager.requestRematch(ws);
          break;
        case 'accept_rematch':
          roomManager.acceptRematch(ws);
          break;
        case 'decline_rematch':
          roomManager.declineRematch(ws);
          break;
        case 'leave_room':
          roomManager.leaveRoom(ws);
          break;
        case 'ping':
          if (ws.readyState === 1) {
            ws.send(
              JSON.stringify({
                type: 'pong',
                clientTime: msg.clientTime,
                serverTime: Date.now(),
              })
            );
          }
          break;
      }
    });

    ws.on('close', () => {
      roomManager.handleSocketClose(ws);
    });
  });

  if (isProduction) {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Retro Pong server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
