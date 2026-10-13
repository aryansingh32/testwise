import 'reflect-metadata';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file: rely on real environment variables (Railway).
}
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './common/redis-io.adapter';
import { lifecycle } from './common/lifecycle';
import { requestId } from './common/request-id';
import { UPLOAD_DIR } from './common/storage.service';

// Node 20 terminates the process on an unhandled rejection. A stray failure in one background job must not take the
// whole API (and every exam in progress) down, so log it. A truly unexpected exception leaves the process in an unknown
// state: log and exit so the orchestrator restarts a clean instance.
process.on('unhandledRejection', (reason) => {
  Logger.error(`Unhandled promise rejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`, undefined, 'Process');
});
process.on('uncaughtException', (err) => {
  Logger.error(`Uncaught exception, exiting: ${err.stack ?? err.message}`, undefined, 'Process');
  setTimeout(() => process.exit(1), 100).unref();
});

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  app.set('trust proxy', 1);
  // `simple` = Node's flat querystring: `?q[]=a&q[b]=c` stays plain strings instead of becoming arrays/objects that reach the database layer.
  app.set('query parser', 'simple');
  app.use(requestId);
  // While draining, ask clients to drop their keep-alive connection after this response so the server can close promptly.
  app.use((_req: unknown, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    if (lifecycle.draining) res.setHeader('Connection', 'close');
    next();
  });
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  const origins = (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({ origin: origins.length ? origins : true, credentials: false, exposedHeaders: ['x-request-id', 'retry-after'] });
  app.useWebSocketAdapter(new RedisIoAdapter(app));
  app.useStaticAssets(UPLOAD_DIR, { prefix: '/uploads/', maxAge: '7d', index: false });
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
  // Must exceed the load balancer's idle timeout (nginx/ALB/Railway ~60s); Node's 5s default closes sockets the proxy still
  // considers open, which surfaces as sporadic 502s under bursty traffic.
  const server = app.getHttpServer() as import('http').Server;
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  /**
   * Graceful shutdown. Nest's own hooks destroy modules (disconnecting the database) BEFORE the HTTP server closes, which
   * fails every request still running during a rolling deploy. Instead: report `draining` on /health so the load balancer
   * stops routing here, optionally wait for it to notice (SHUTDOWN_DELAY_MS), stop accepting connections, let in-flight
   * requests finish (bounded), and only then tear the app down.
   */
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    lifecycle.draining = true;
    Logger.log(`${signal} received: draining`, 'Bootstrap');
    const delay = Number(process.env.SHUTDOWN_DELAY_MS ?? 0);
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    const drained = new Promise<void>((resolve) => server.close(() => resolve()));
    // Connections that finish a request during the drain become idle afterwards; keep sweeping them until the server is closed.
    const sweep = setInterval(() => server.closeIdleConnections?.(), 200);
    void drained.then(() => clearInterval(sweep));
    const limit = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 25_000);
    await Promise.race([drained, new Promise((r) => setTimeout(r, limit))]);
    try {
      await app.close();
    } catch (e) {
      Logger.error(`Error while closing: ${(e as Error).message}`, undefined, 'Bootstrap');
    }
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
  Logger.log(`API listening on :${port}`, 'Bootstrap');
}
void bootstrap();
