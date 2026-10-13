import { Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, OnGatewayDisconnect, OnGatewayInit, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { hasPermission, proctorHeartbeatSchema } from '@testwise/shared';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../common/prisma.service';
import { TokensService } from '../common/tokens.service';
import { ProctorBus, ProctoringService } from './proctoring.service';

interface SocketData {
  kind: 'student' | 'admin';
  userId?: string;
  adminId?: string;
  sessionId?: string;
  tournamentId?: string | null;
}

/**
 * Live proctoring channel.
 * Students: connect with { token, attemptId }; send `hb` heartbeats (app state, question,
 * faces, integrity); receive `proctor:warning`, `proctor:terminated`, `live:start`, `live:stop`.
 * Admins (proctor.view): connect with { token, admin: true }; `watch` a tournament (or "all" /
 * "practice"); receive `session:update`, `session:snapshot`, `flag:new`, `action:new`.
 */
@WebSocketGateway({ namespace: '/proctor', cors: { origin: true } })
export class ProctoringGateway implements OnGatewayInit, OnGatewayDisconnect {
  private readonly logger = new Logger('ProctorGateway');

  constructor(
    private readonly tokens: TokensService,
    private readonly prisma: PrismaService,
    private readonly proctoring: ProctoringService,
    private readonly bus: ProctorBus,
  ) {}

  afterInit(server: Server) {
    this.bus.server = server;
    server.use((socket, next) => {
      void (async () => {
        try {
          const auth = socket.handshake.auth ?? {};
          const data = socket.data as SocketData;
          if (auth.admin) {
            const p = await this.tokens.verifyAccess('ADMIN', String(auth.token ?? ''));
            const admin = await this.prisma.adminUser.findUnique({ where: { id: p.sub } });
            if (!admin?.active || !hasPermission(admin.role, 'proctor.view')) throw new Error('forbidden');
            data.kind = 'admin';
            data.adminId = admin.id;
          } else {
            const p = await this.tokens.verifyAccess('USER', String(auth.token ?? ''));
            const session = await this.proctoring.sessionForSocket(p.sub, String(auth.attemptId ?? ''));
            if (!session) throw new Error('no active proctoring session');
            data.kind = 'student';
            data.userId = p.sub;
            data.sessionId = session.id;
            data.tournamentId = session.tournamentId;
            await socket.join(`s:${session.id}`);
          }
          next();
        } catch (e) {
          next(new Error((e as Error).message === 'forbidden' ? 'forbidden' : 'unauthorized'));
        }
      })();
    });
    server.on('connection', (socket: Socket) => {
      const d = socket.data as SocketData;
      if (d.kind === 'student') this.bus.toAdmins(d.tournamentId ?? null, 'session:update', { sessionId: d.sessionId, online: true });
    });
  }

  handleDisconnect(socket: Socket) {
    const d = socket.data as SocketData;
    if (d.kind === 'student') this.bus.toAdmins(d.tournamentId ?? null, 'session:update', { sessionId: d.sessionId, online: false });
  }

  @SubscribeMessage('hb')
  async heartbeat(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    const d = socket.data as SocketData;
    if (d.kind !== 'student' || !d.sessionId) return { ok: false };
    const parsed = proctorHeartbeatSchema.safeParse(body);
    if (!parsed.success) return { ok: false, error: 'bad heartbeat' };
    try {
      const s = await this.proctoring.heartbeat(d.sessionId, parsed.data);
      return { ok: !!s, status: s?.status ?? 'ENDED', liveRequested: s?.liveRequested ?? false, reattestDue: s ? await this.proctoring.reattestDue(s.attestedAt) : false };
    } catch (e) {
      this.logger.warn(`heartbeat failed: ${(e as Error).message}`);
      return { ok: false };
    }
  }

  @SubscribeMessage('watch')
  async watch(@ConnectedSocket() socket: Socket, @MessageBody() body: { scope?: string }) {
    const d = socket.data as SocketData;
    if (d.kind !== 'admin') return { ok: false };
    for (const room of socket.rooms) if (room.startsWith('admins:')) await socket.leave(room);
    const scope = body?.scope ?? 'all';
    await socket.join(scope === 'all' ? 'admins:all' : scope === 'practice' ? 'admins:practice' : `admins:t:${scope}`);
    return { ok: true };
  }
}
