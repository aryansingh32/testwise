import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Duel } from '@prisma/client';
import type { DuelFinishedDto, DuelPlayerDto, DuelQuestionDto, DuelQuestionResultDto } from '@testwise/shared';
import { randomUUID } from 'crypto';
import type { Server, Socket } from 'socket.io';
import { AppConfigService } from '../app-config/app-config.service';
import { PrismaService } from '../common/prisma.service';
import { TokensService } from '../common/tokens.service';
import { NotificationsService } from '../notifications/notifications.service';
import { answerPoints, botAnswer, pseudoId, seededRandom, tierFor } from './duel-logic';
import { DuelsService, type DuelQuestion } from './duels.service';
import { PaidDuelsService } from './paid-duels.service';

type Side = 'A' | 'B';
interface Player {
  userId: string | null; // null = bot
  pid: string; // opaque id shown to the other player
  name: string;
  rating: number;
  color: string;
}
interface Answer {
  label: string | null;
  timeMs: number;
  points: number;
  correct: boolean;
}
interface LiveDuel {
  duel: Duel;
  questions: DuelQuestion[];
  players: Record<Side, Player>;
  index: number;
  qStartedAt: number;
  answers: Map<number, Partial<Record<Side, Answer>>>;
  scores: Record<Side, number>;
  timers: NodeJS.Timeout[];
  resolving: boolean;
}
interface QueueEntry {
  userId: string;
  examId: string | null;
  rating: number;
  joinedAt: number;
}

const COLORS = ['#F97316', '#EC4899', '#8B5CF6', '#FACC15', '#22D3EE', '#10B981'];
const other = (s: Side): Side => (s === 'A' ? 'B' : 'A');

@WebSocketGateway({ namespace: '/duels', cors: { origin: true } })
export class DuelsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger('Duels');
  private readonly queue = new Map<string, QueueEntry>();
  private readonly live = new Map<string, LiveDuel>();
  private readonly userDuel = new Map<string, string>();
  private readonly online = new Map<string, number>();
  private readonly rematch = new Map<string, { players: Record<Side, Player>; mode: Duel['mode']; examId: string | null; requested: Set<Side>; until: number; botPersonaId: string | null; botRating: number | null }>();
  private readonly hostWaiting = new Set<string>();
  private readonly paidAnnounced = new Set<string>();
  private ticker?: NodeJS.Timeout;
  private sweeper?: NodeJS.Timeout;

  constructor(
    private readonly duels: DuelsService,
    private readonly tokens: TokensService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly notifications: NotificationsService,
    private readonly paid: PaidDuelsService,
  ) {}

  async onModuleInit() {
    const role = process.env.DUELS_ENGINE_ENABLED;
    if (process.env.NODE_ENV === 'production' && role !== 'true' && role !== 'false') {
      throw new Error('Set DUELS_ENGINE_ENABLED=true on the dedicated duel engine and false on every horizontally scaled API replica');
    }
    if (role === 'false') return;
    // Live duel state is held by the instance that started it. Duels left ACTIVE long after
    // they could have finished belong to a crashed instance: mark them abandoned. Recent ones
    // may be running on another instance, so they are left alone.
    const sweep = () =>
      this.prisma.duel.updateMany({ where: { status: 'ACTIVE', startedAt: { lt: new Date(Date.now() - 15 * 60_000) } }, data: { status: 'ABANDONED', finishedAt: new Date() } }).catch(() => undefined);
    await sweep();
    if (process.env.NODE_ENV !== 'test') this.sweeper = setInterval(() => void sweep(), 5 * 60_000);
    if (process.env.NODE_ENV !== 'test') this.ticker = setInterval(() => void this.matchmake(), 1000);
  }

  onModuleDestroy() {
    if (this.ticker) clearInterval(this.ticker);
    if (this.sweeper) clearInterval(this.sweeper);
    for (const l of this.live.values()) l.timers.forEach(clearTimeout);
  }

  // ------------------------------------------------------------- Connections

  /** Authenticate in middleware so no message is handled before the user is known. */
  afterInit(server: Server) {
    server.use((socket, next) => {
      if (process.env.DUELS_ENGINE_ENABLED === 'false') {
        next(new Error('Duel sockets are served by the dedicated duel engine'));
        return;
      }
      void (async () => {
        try {
          const token = (socket.handshake.auth?.token as string) ?? '';
          const payload = await this.tokens.verifyAccess('USER', token);
          const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, status: true } });
          if (!user || user.status !== 'ACTIVE') throw new Error('inactive');
          socket.data.userId = user.id;
          next();
        } catch {
          next(new Error('Unauthorized'));
        }
      })();
    });
  }

  async handleConnection(socket: Socket) {
    const userId = socket.data.userId as string | undefined;
    if (!userId) return socket.disconnect(true);
    await socket.join(`user:${userId}`);
    this.online.set(userId, (this.online.get(userId) ?? 0) + 1);
    const duelId = this.userDuel.get(userId);
    if (duelId) void this.sendState(userId, duelId);
    const paidRoom = await this.paid.matchedRoomFor(userId);
    if (paidRoom) this.emit(userId, 'paid:matched', { roomId: paidRoom.id, duelId: paidRoom.duelId });
  }

  handleDisconnect(socket: Socket) {
    const userId = socket.data.userId as string | undefined;
    if (!userId) return;
    const n = (this.online.get(userId) ?? 1) - 1;
    if (n <= 0) {
      this.online.delete(userId);
      this.queue.delete(userId);
      this.hostWaiting.delete(userId);
    } else this.online.set(userId, n);
  }

  private emit(userId: string | null, event: string, data: unknown) {
    if (userId) this.server.to(`user:${userId}`).emit(event, data);
  }

  // ------------------------------------------------------------- Matchmaking

  @SubscribeMessage('queue:join')
  async joinQueue(@ConnectedSocket() socket: Socket, @MessageBody() body: { examId?: string | null }) {
    const userId = socket.data.userId as string;
    try {
      await this.duels.ensureEnabled();
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    if (this.userDuel.has(userId)) {
      this.sendState(userId, this.userDuel.get(userId)!);
      return { ok: true, resumed: true };
    }
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { duelRating: true } });
    this.queue.set(userId, { userId, examId: body?.examId ?? null, rating: u.duelRating, joinedAt: Date.now() });
    return { ok: true };
  }

  @SubscribeMessage('queue:leave')
  leaveQueue(@ConnectedSocket() socket: Socket) {
    this.queue.delete(socket.data.userId as string);
    return { ok: true };
  }

  /** Coin-duel rooms with two players: tell the waiting player, and start once both are connected. */
  private async startPaidRooms() {
    const rooms = await this.paid.matchedRooms();
    for (const r of rooms) {
      if (!r.duelId || !r.playerAId || !r.playerBId || this.live.has(r.duelId)) continue;
      if (!this.paidAnnounced.has(r.id)) {
        this.paidAnnounced.add(r.id);
        for (const uid of [r.playerAId, r.playerBId]) this.emit(uid, 'paid:matched', { roomId: r.id, duelId: r.duelId });
      }
      if (!this.online.has(r.playerAId) || !this.online.has(r.playerBId)) continue;
      const duel = await this.prisma.duel.findUnique({ where: { id: r.duelId } });
      if (!duel || duel.status !== 'WAITING') continue;
      const [pa, pb] = await Promise.all([this.player(r.playerAId, COLORS[0]), this.player(r.playerBId, COLORS[1])]);
      await this.start({ A: pa, B: pb }, 'PAID', duel.examId, null, undefined, duel.id);
      await this.paid.markActive(r.id);
      this.paidAnnounced.delete(r.id);
    }
  }

  private async matchmake() {
    await this.startPaidRooms().catch((e) => this.logger.error(`paid rooms: ${(e as Error).message}`));
    if (!this.queue.size) return;
    const [s, bots] = await Promise.all([this.duels.settings(), this.config.get('duels.bots')]);
    const now = Date.now();
    const entries = [...this.queue.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    const used = new Set<string>();
    for (const a of entries) {
      if (used.has(a.userId)) continue;
      const waited = (now - a.joinedAt) / 1000;
      const windowA = s.ratingWindow + s.ratingWindowGrowthPerSecond * waited;
      let best: QueueEntry | null = null;
      for (const b of entries) {
        if (b.userId === a.userId || used.has(b.userId) || b.examId !== a.examId) continue;
        const windowB = s.ratingWindow + s.ratingWindowGrowthPerSecond * ((now - b.joinedAt) / 1000);
        const diff = Math.abs(a.rating - b.rating);
        if (diff <= Math.max(windowA, windowB) && (!best || diff < Math.abs(a.rating - best.rating))) best = b;
      }
      if (best) {
        used.add(a.userId).add(best.userId);
        this.queue.delete(a.userId);
        this.queue.delete(best.userId);
        void this.startHumanDuel(a, best);
      } else if (bots.enabled && waited >= bots.waitSecondsBeforeBot) {
        // Bots only ever join free, no-reward ranked duels (all duels are free to play).
        used.add(a.userId);
        this.queue.delete(a.userId);
        void this.startBotDuel(a, bots.adaptiveToPlayerRating);
      } else {
        this.emit(a.userId, 'queue:searching', { waitedSec: Math.floor(waited) });
      }
    }
  }

  private async player(userId: string, color: string): Promise<Player> {
    const d = await this.duels.displayName(userId);
    return { userId, pid: userId, name: d.name, rating: d.rating, color };
  }

  private async startHumanDuel(a: QueueEntry, b: QueueEntry) {
    const [pa, pb] = await Promise.all([this.player(a.userId, COLORS[0]), this.player(b.userId, COLORS[1])]);
    await this.start({ A: pa, B: pb }, 'RANKED', a.examId, null);
  }

  private async startBotDuel(a: QueueEntry, adaptive: boolean) {
    const pa = await this.player(a.userId, COLORS[0]);
    const bot = await this.duels.randomPersona(pa.rating, adaptive);
    if (!bot) {
      this.emit(a.userId, 'queue:error', { message: 'No opponents are available right now. Please try again shortly.' });
      return;
    }
    const pb: Player = { userId: null, pid: pseudoId(), name: bot.persona.name, rating: bot.rating, color: bot.persona.color };
    await this.start({ A: pa, B: pb }, 'RANKED', a.examId, null, { botPersonaId: bot.persona.id, botRating: bot.rating });
  }

  // ------------------------------------------------------------- Duel lifecycle

  private async start(players: Record<Side, Player>, mode: Duel['mode'], examId: string | null, rematchOfId: string | null, bot?: { botPersonaId: string; botRating: number }, existingId?: string) {
    const global = await this.duels.settings();
    // A duel that already has a row (coin duel, friend challenge) keeps the length and pace it was created with:
    // for coin duels that is what the admin set on the offer.
    const planned = existingId ? await this.prisma.duel.findUnique({ where: { id: existingId }, select: { questionCount: true, secondsPerQuestion: true } }) : null;
    const s = { ...global, questionCount: planned?.questionCount ?? global.questionCount, secondsPerQuestion: planned?.secondsPerQuestion ?? global.secondsPerQuestion };
    const botSeed = bot ? randomUUID() : null;
    let questions: DuelQuestion[];
    try {
      questions = await this.duels.pickQuestions(examId, s.questionCount);
    } catch (e) {
      for (const p of [players.A, players.B]) this.emit(p.userId, 'queue:error', { message: (e as Error).message });
      return;
    }
    const data = {
      mode, status: 'ACTIVE' as const, examId, playerAId: players.A.userId!, playerBId: players.B.userId, botPersonaId: bot?.botPersonaId ?? null,
      botRating: bot?.botRating ?? null, botSeed, paper: questions as never, questionCount: questions.length, secondsPerQuestion: s.secondsPerQuestion,
      ratingABefore: players.A.rating, ratingBBefore: players.B.rating, rematchOfId, startedAt: new Date(),
    };
    const duel = existingId ? await this.prisma.duel.update({ where: { id: existingId }, data }) : await this.prisma.duel.create({ data });
    const live: LiveDuel = { duel, questions, players, index: -1, qStartedAt: 0, answers: new Map(), scores: { A: 0, B: 0 }, timers: [], resolving: false };
    this.live.set(duel.id, live);
    for (const side of ['A', 'B'] as Side[]) {
      const p = players[side];
      if (!p.userId) continue;
      this.userDuel.set(p.userId, duel.id);
      this.queue.delete(p.userId);
      this.emit(p.userId, 'duel:matched', {
        duelId: duel.id, you: this.dto(p, s.tiers), opponent: this.dto(players[other(side)], s.tiers),
        questionCount: questions.length, secondsPerQuestion: s.secondsPerQuestion, startsAt: new Date(Date.now() + 3500).toISOString(), mode,
      });
    }
    live.timers.push(setTimeout(() => this.ask(duel.id, 0), 3500));
  }

  private dto(p: Player, tiers: { name: string; nameHi: string; minRating: number; color: string }[]): DuelPlayerDto {
    return { id: p.pid, name: p.name, rating: p.rating, color: p.color, tier: tierFor(p.rating, tiers).tier.name };
  }

  private questionDto(l: LiveDuel, i: number): DuelQuestionDto {
    const q = l.questions[i];
    return {
      index: i, total: l.questions.length, textEn: q.textEn, textHi: q.textHi, imageUrl: q.imageUrl, options: q.options,
      endsAt: new Date(l.qStartedAt + l.duel.secondsPerQuestion * 1000).toISOString(), serverNow: new Date().toISOString(),
    };
  }

  private async ask(duelId: string, i: number) {
    const l = this.live.get(duelId);
    if (!l) return;
    l.index = i;
    l.qStartedAt = Date.now();
    l.resolving = false;
    l.answers.set(i, {});
    const q = this.questionDto(l, i);
    this.emit(l.players.A.userId, 'duel:question', q);
    this.emit(l.players.B.userId, 'duel:question', q);
    if (!l.players.B.userId) {
      const bots = await this.config.get('duels.bots');
      const qq = l.questions[i];
      const seed = l.duel.botSeed ?? `${l.duel.id}:${i}`;
      const profileRandom = seededRandom(`${seed}:profile`);
      const questionRandom = seededRandom(`${seed}:question:${i}`);
      const performanceOffset = (profileRandom() - 0.5) * 0.16;
      const a = botAnswer(
        { difficulty: qq.difficulty, labels: qq.options.map((o) => o.label), correct: qq.correct },
        bots,
        { playerRating: l.players.A.rating, secondsPerQuestion: l.duel.secondsPerQuestion, performanceOffset },
        questionRandom,
      );
      l.timers.push(setTimeout(() => this.record(duelId, 'B', i, a.label), a.timeMs));
    }
    l.timers.push(setTimeout(() => void this.resolve(duelId, i), l.duel.secondsPerQuestion * 1000 + 400));
  }

  @SubscribeMessage('duel:answer')
  answer(@ConnectedSocket() socket: Socket, @MessageBody() body: { duelId: string; index: number; label: string | null }) {
    const userId = socket.data.userId as string;
    const l = this.live.get(body?.duelId);
    if (!l) return { ok: false, error: 'Duel not active' };
    const side: Side | null = l.players.A.userId === userId ? 'A' : l.players.B.userId === userId ? 'B' : null;
    if (!side) return { ok: false, error: 'Not your duel' };
    return this.record(l.duel.id, side, body.index, body.label ?? null);
  }

  private record(duelId: string, side: Side, index: number, label: string | null) {
    const l = this.live.get(duelId);
    if (!l || l.index !== index || l.resolving) return { ok: false, error: 'Question closed' };
    const slot = l.answers.get(index)!;
    if (slot[side]) return { ok: false, error: 'Already answered' };
    const timeMs = Date.now() - l.qStartedAt;
    if (timeMs > l.duel.secondsPerQuestion * 1000 + 300) return { ok: false, error: 'Time is up' };
    const q = l.questions[index];
    const valid = label && q.options.some((o) => o.label === label) ? label : null;
    const correct = valid === q.correct;
    const s = { pointsCorrect: 10, maxSpeedBonus: 10, secondsPerQuestion: l.duel.secondsPerQuestion };
    slot[side] = { label: valid, timeMs, correct, points: 0 };
    void this.duels.settings().then((cfg) => {
      slot[side]!.points = answerPoints(correct, timeMs, { ...s, pointsCorrect: cfg.pointsCorrect, maxSpeedBonus: cfg.maxSpeedBonus });
      void this.prisma.duelAnswer
        .create({ data: { duelId, side, questionIndex: index, selectedLabels: valid ? [valid] : [], isCorrect: correct, timeMs, points: slot[side]!.points } })
        .catch(() => undefined);
      this.emit(l.players[other(side)].userId, 'duel:opponent_answered', { index });
      if (slot.A && slot.B) void this.resolve(duelId, index);
    });
    return { ok: true };
  }

  private async resolve(duelId: string, index: number) {
    const l = this.live.get(duelId);
    if (!l || l.index !== index || l.resolving) return;
    l.resolving = true;
    const slot = l.answers.get(index)!;
    const q = l.questions[index];
    for (const side of ['A', 'B'] as Side[]) l.scores[side] += slot[side]?.points ?? 0;
    for (const side of ['A', 'B'] as Side[]) {
      const res: DuelQuestionResultDto = {
        index, correctLabels: [q.correct],
        yourLabels: slot[side]?.label ? [slot[side]!.label!] : [], yourPoints: slot[side]?.points ?? 0,
        opponentLabels: slot[other(side)]?.label ? [slot[other(side)]!.label!] : [], opponentPoints: slot[other(side)]?.points ?? 0,
        scores: { you: l.scores[side], opponent: l.scores[other(side)] },
      };
      this.emit(l.players[side].userId, 'duel:question_result', res);
    }
    l.timers.push(setTimeout(() => (index + 1 < l.questions.length ? void this.ask(duelId, index + 1).catch((e) => this.logger.error(`ask ${duelId}: ${(e as Error).stack}`)) : void this.finish(duelId).catch((e) => this.logger.error(`finish ${duelId}: ${(e as Error).stack}`))), 2500));
  }

  @SubscribeMessage('duel:forfeit')
  async forfeit(@ConnectedSocket() socket: Socket, @MessageBody() body: { duelId: string }) {
    const userId = socket.data.userId as string;
    const l = this.live.get(body?.duelId);
    if (!l) return { ok: false };
    const side: Side | null = l.players.A.userId === userId ? 'A' : l.players.B.userId === userId ? 'B' : null;
    if (!side) return { ok: false };
    // The player who leaves loses: give the opponent a winning margin.
    l.scores[other(side)] = Math.max(l.scores[other(side)], l.scores[side] + 1);
    await this.finish(l.duel.id);
    return { ok: true };
  }

  private async finish(duelId: string) {
    const l = this.live.get(duelId);
    if (!l) return;
    this.live.delete(duelId);
    l.timers.forEach(clearTimeout);
    const result = await this.duels.finish(l.duel, l.scores.A, l.scores.B);
    const s = await this.duels.settings();
    // A coin duel is a one-off contest with escrowed entries: no free rematch of it.
    const paidDuel = l.duel.mode === 'PAID';
    const until = paidDuel ? Date.now() : Date.now() + s.rematchWindowSeconds * 1000;
    if (!paidDuel) this.rematch.set(duelId, { players: l.players, mode: l.duel.mode, examId: l.duel.examId, requested: new Set(), until, botPersonaId: l.duel.botPersonaId, botRating: l.duel.botRating });
    if (!paidDuel) setTimeout(() => this.rematch.delete(duelId), s.rematchWindowSeconds * 1000 + 1000);
    for (const side of ['A', 'B'] as Side[]) {
      const p = l.players[side];
      if (!p.userId) continue;
      this.userDuel.delete(p.userId);
      const before = side === 'A' ? result?.ratedA ?? p.rating : result?.ratedB ?? p.rating;
      const after = side === 'A' ? result?.afterA ?? p.rating : result?.afterB ?? p.rating;
      const mine = l.scores[side];
      const theirs = l.scores[other(side)];
      const dto: DuelFinishedDto = {
        duelId, outcome: mine === theirs ? 'DRAW' : mine > theirs ? 'WIN' : 'LOSS', scores: { you: mine, opponent: theirs },
        ratingBefore: before, ratingAfter: after, xpEarned: side === 'A' ? result?.xpA ?? 0 : result?.xpB ?? 0,
        opponent: this.dto(l.players[other(side)], s.tiers), rematchAvailableUntil: new Date(until).toISOString(),
      };
      this.emit(p.userId, 'duel:finished', dto);
    }
  }

  /** Re-send the current state after a reconnect. */
  private async sendState(userId: string, duelId: string) {
    const l = this.live.get(duelId);
    if (!l) return;
    const s = await this.duels.settings();
    const side: Side = l.players.A.userId === userId ? 'A' : 'B';
    this.emit(userId, 'duel:matched', {
      duelId, you: this.dto(l.players[side], s.tiers), opponent: this.dto(l.players[other(side)], s.tiers),
      questionCount: l.questions.length, secondsPerQuestion: l.duel.secondsPerQuestion, startsAt: new Date().toISOString(), mode: l.duel.mode, resumed: true,
      scores: { you: l.scores[side], opponent: l.scores[other(side)] },
    });
    if (l.index >= 0 && !l.resolving) {
      this.emit(userId, 'duel:question', { ...this.questionDto(l, l.index), alreadyAnswered: !!l.answers.get(l.index)?.[side] });
    }
  }

  @SubscribeMessage('duel:state')
  state(@ConnectedSocket() socket: Socket) {
    const userId = socket.data.userId as string;
    const id = this.userDuel.get(userId);
    if (id) void this.sendState(userId, id);
    return { active: !!id, duelId: id ?? null };
  }

  // ------------------------------------------------------------- Rematch

  @SubscribeMessage('rematch:request')
  async requestRematch(@ConnectedSocket() socket: Socket, @MessageBody() body: { duelId: string }) {
    const userId = socket.data.userId as string;
    const r = this.rematch.get(body?.duelId);
    if (!r || Date.now() > r.until) return { ok: false, error: 'Rematch window closed' };
    const side: Side | null = r.players.A.userId === userId ? 'A' : r.players.B.userId === userId ? 'B' : null;
    if (!side) return { ok: false };
    r.requested.add(side);
    const opp = r.players[other(side)];
    if (!opp.userId) {
      // Bot opponents accept after a short, human-like pause.
      setTimeout(() => {
        if (!this.rematch.has(body.duelId)) return;
        this.rematch.delete(body.duelId);
        void this.start({ A: r.players.A, B: r.players.B }, r.mode, r.examId, body.duelId, r.botPersonaId ? { botPersonaId: r.botPersonaId, botRating: r.botRating ?? r.players.B.rating } : undefined);
      }, 1500 + Math.random() * 2500);
      return { ok: true, waiting: true };
    }
    if (r.requested.size === 2) {
      this.rematch.delete(body.duelId);
      const [a, b] = await Promise.all([this.player(r.players.A.userId!, r.players.A.color), this.player(r.players.B.userId!, r.players.B.color)]);
      await this.start({ A: a, B: b }, r.mode, r.examId, body.duelId);
      return { ok: true, started: true };
    }
    this.emit(opp.userId, 'rematch:offer', { duelId: body.duelId, from: r.players[side].name, until: new Date(r.until).toISOString() });
    if (!this.online.has(opp.userId)) await this.notifications.event('DUEL_REMATCH_REQUEST', opp.userId, { opponent: r.players[side].name }, { link: '/duels' });
    return { ok: true, waiting: true };
  }

  @SubscribeMessage('rematch:decline')
  declineRematch(@ConnectedSocket() socket: Socket, @MessageBody() body: { duelId: string }) {
    const r = this.rematch.get(body?.duelId);
    if (!r) return { ok: false };
    this.rematch.delete(body.duelId);
    for (const p of [r.players.A, r.players.B]) if (p.userId && p.userId !== socket.data.userId) this.emit(p.userId, 'rematch:declined', { duelId: body.duelId });
    return { ok: true };
  }

  // ------------------------------------------------------------- Friend challenges

  @SubscribeMessage('challenge:wait')
  async waitChallenge(@ConnectedSocket() socket: Socket, @MessageBody() body: { duelId: string }) {
    const userId = socket.data.userId as string;
    const d = await this.prisma.duel.findUnique({ where: { id: body?.duelId } });
    if (!d || d.playerAId !== userId || d.status !== 'WAITING') return { ok: false, error: 'Challenge not found' };
    this.hostWaiting.add(userId);
    if (d.playerBId && this.online.has(d.playerBId)) await this.startFriend(d);
    return { ok: true, code: d.inviteCode, opponentJoined: !!d.playerBId };
  }

  @SubscribeMessage('challenge:join')
  async joinChallenge(@ConnectedSocket() socket: Socket, @MessageBody() body: { code: string }) {
    const userId = socket.data.userId as string;
    try {
      const d = await this.duels.joinChallenge(userId, body?.code ?? '');
      if (this.online.has(d.playerAId)) await this.startFriend(d);
      else this.emit(userId, 'challenge:joined', { duelId: d.id, waitingForHost: true });
      return { ok: true, duelId: d.id };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  private async startFriend(d: Duel) {
    if (this.live.has(d.id) || !d.playerBId) return;
    this.hostWaiting.delete(d.playerAId);
    const [a, b] = await Promise.all([this.player(d.playerAId, COLORS[0]), this.player(d.playerBId, COLORS[1])]);
    await this.start({ A: a, B: b }, 'FRIEND', d.examId, null, undefined, d.id);
  }
}
