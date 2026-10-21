/**
 * GOLD RING server.
 *
 * Fastify for REST, `ws` for the realtime lane, Zod for every payload, helmet
 * and rate limiting for hygiene, pino for logs. The server is the single source
 * of truth for the clock and for shot validity.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { WebSocketServer } from 'ws';
import { JsonStore } from './db/store';
import { registerRoutes } from './routes/index';
import { MatchServer } from './ws/matchServer';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';

async function main(): Promise<void> {
  const store = new JsonStore(process.env.DATA_DIR);
  const matchServer = new MatchServer();

  const app = Fastify({
    logger:
      process.env.NODE_ENV === 'production'
        ? { level: process.env.LOG_LEVEL ?? 'info' }
        : {
            level: process.env.LOG_LEVEL ?? 'info',
            transport: {
              target: 'pino-pretty',
              options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
            },
          },
    trustProxy: true,
    bodyLimit: 64 * 1024,
  });

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN?.split(',') ?? true,
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, {
    max: Number(process.env.RATE_LIMIT_MAX ?? 240),
    timeWindow: '1 minute',
    allowList: [],
  });

  app.get('/', async () => ({
    name: 'GOLD RING server',
    version: '1.0.0',
    endpoints: ['/api/health', '/api/formats', '/api/score', '/api/leaderboard', '/api/daily', '/api/equipment', '/ws'],
  }));

  await registerRoutes(app, store);

  // WebSocket upgrade on /ws (kept out of Fastify's HTTP routing on purpose).
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (socket) => matchServer.handleConnection(socket));

  app.server.on('upgrade', (request, socket, head) => {
    const url = request.url ?? '';
    if (!url.startsWith('/ws')) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  app.get('/api/live', async () => matchServer.stats());

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    matchServer.close();
    wss.close();
    store.flush();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`GOLD RING server listening on http://${HOST}:${PORT}`);
}

main().catch((error) => {
  console.error('[GOLD RING] server failed to start', error);
  process.exit(1);
});
