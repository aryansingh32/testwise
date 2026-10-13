import { Logger, type INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Server, ServerOptions } from 'socket.io';
import { RedisService } from './redis.service';

/**
 * Socket.IO over Redis pub/sub, so events emitted to a room reach sockets connected
 * to any API instance (duels, live proctoring). Falls back to the in-memory adapter
 * when Redis is not configured.
 */
export class RedisIoAdapter extends IoAdapter {
  constructor(private readonly ctx: INestApplicationContext) {
    super(ctx);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    const pair = this.ctx.get(RedisService).duplicatePair();
    if (pair) {
      server.adapter(createAdapter(pair[0], pair[1]));
      Logger.log('Socket.IO using Redis adapter', 'Redis');
    }
    return server;
  }
}
