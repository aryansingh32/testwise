import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, type DuelOffer, type DuelRoom } from '@prisma/client';
import type { AdminPaidDuelOfferDto, Eligibility, PaidDuelJoinResultDto, PaidDuelOfferDto, PaidDuelOfferInput, PaidDuelOfferUpdate } from '@testwise/shared';
import { AppConfigService } from '../app-config/app-config.service';
import { isMinor } from '../auth/user-mapper';
import { AuditService, type AuditActor } from '../common/audit.service';
import { audienceReason } from '../common/eligibility';
import { PrismaService } from '../common/prisma.service';
import { RedisService } from '../common/redis.service';
import { istDayStart } from '../engagement/engagement.services';
import { NotificationsService } from '../notifications/notifications.service';
import { WalletService } from '../wallet/wallet.service';

type Tx = Prisma.TransactionClient;
const IN_PLAY = ['WAITING', 'MATCHED', 'ACTIVE'] as const;

/**
 * Admin-created 1v1 coin duels. The server is the only authority on money and results:
 *  - the app names a room; entry, prize and eligibility all come from the database;
 *  - the entry is moved into escrow in the same transaction that claims the seat (no seat without coins, no coins without a seat);
 *  - settlement runs once, from the server's own duel result, and every step is idempotent in the coin ledger;
 *  - a no-show, an abandoned duel, a cancelled room or a draw refunds the escrowed entries.
 */
@Injectable()
export class PaidDuelsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PaidDuels');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly wallet: WalletService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.DUELS_ENGINE_ENABLED === 'false') return;
    this.timer = setInterval(() => void this.redis.withLock('job:paid-duels-sweep', 20_000, () => this.sweep()).catch((e) => this.logger.error(e)), 5_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  policy() {
    return this.config.get('duels.paid');
  }

  // ------------------------------------------------------------- Student side

  private async requireOn() {
    const [p, flags, ws] = await Promise.all([this.policy(), this.config.get('features.flags'), this.wallet.settings()]);
    if (!flags.duels || !ws.enabled || !p.enabled) throw new ForbiddenException('Coin duels are not available right now');
    return p;
  }

  private async eligibility(offer: DuelOffer, userId: string): Promise<{ en: string; hi: string } | null> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const el = (offer.eligibility ?? {}) as Partial<Eligibility>;
    const exams = el.examIds?.length ? (await this.prisma.userExam.findMany({ where: { userId }, select: { examId: true } })).map((e) => e.examId) : [];
    return audienceReason(el, user, exams, 'duel');
  }

  async offers(userId: string): Promise<PaidDuelOfferDto[]> {
    const p = await this.policy();
    if (!p.enabled) return [];
    const offers = await this.prisma.duelOffer.findMany({ where: { status: 'LIVE' }, orderBy: { createdAt: 'desc' }, include: { rooms: { select: { id: true, status: true, playerAId: true, playerBId: true, duelId: true, waitingUntil: true } } } });
    const exams = new Map((await this.prisma.exam.findMany({ where: { id: { in: offers.map((o) => o.examId).filter(Boolean) as string[] } }, select: { id: true, nameEn: true, nameHi: true } })).map((e) => [e.id, { en: e.nameEn, hi: e.nameHi ?? e.nameEn }]));
    const out: PaidDuelOfferDto[] = [];
    for (const o of offers) {
      const count = (s: string) => o.rooms.filter((r) => r.status === s).length;
      const mine = o.rooms.find((r) => (r.playerAId === userId || r.playerBId === userId) && (IN_PLAY as readonly string[]).includes(r.status));
      const reason = await this.eligibility(o, userId);
      out.push({
        id: o.id, titleEn: o.titleEn, titleHi: o.titleHi, entryCoins: o.entryCoins, prizeCoins: o.prizeCoins, feeCoins: o.entryCoins * 2 - o.prizeCoins,
        questionCount: o.questionCount, secondsPerQuestion: o.secondsPerQuestion, examName: o.examId ? exams.get(o.examId) ?? null : null,
        openRooms: count('OPEN'), waitingRooms: count('WAITING'), playingRooms: count('MATCHED') + count('ACTIVE'), finishedRooms: count('FINISHED'),
        eligible: !reason, ineligibleReasonEn: reason?.en ?? null, ineligibleReasonHi: reason?.hi ?? null,
        myRoom: mine ? { id: mine.id, status: mine.status as 'WAITING' | 'MATCHED' | 'ACTIVE', duelId: mine.duelId, waitingUntil: mine.waitingUntil?.toISOString() ?? null } : null,
      });
    }
    return out;
  }

  /**
   * Take a seat in the best room of an offer: a room with one player waiting first (so the duel starts at once),
   * otherwise an empty one. The seat and the escrowed entry are one transaction.
   */
  async join(userId: string, offerId: string): Promise<PaidDuelJoinResultDto> {
    const p = await this.requireOn();
    const [user, age, offer] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      this.config.get('policy.age'),
      this.prisma.duelOffer.findUnique({ where: { id: offerId } }),
    ]);
    if (!offer || offer.status !== 'LIVE') throw new NotFoundException('This duel is not open');
    if (user.status !== 'ACTIVE') throw new ForbiddenException('Your account cannot join duels');
    const minor = isMinor(user, age.adultAge);
    // Real-money coins can never fund a minor's entry, whatever the admin setting says.
    const source = minor ? 'EARNED_ONLY' : p.entrySource;
    if (minor && (!p.minorsAllowed || (age.minorRequiresGuardianConsent && !user.guardianConsent))) throw new ForbiddenException('Coin duels need a parent or guardian’s consent for under-18 students');
    const reason = await this.eligibility(offer, userId);
    if (reason) throw new ForbiddenException(reason.en);

    const active = await this.prisma.duelRoom.count({ where: { status: { in: [...IN_PLAY] }, OR: [{ playerAId: userId }, { playerBId: userId }] } });
    if (active >= p.maxActiveRoomsPerUser) throw new ConflictException('Finish your current coin duel first');
    const today = await this.wallet.duelEntriesToday(userId, istDayStart());
    if (today.count >= p.maxEntriesPerDay || today.coins + offer.entryCoins > p.maxEntryCoinsPerDay) throw new ForbiddenException('You have reached today’s coin duel limit. Come back tomorrow.');

    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => this.takeSeat(tx, offer, userId, source, p.waitMinutes, p.readySeconds));
      } catch (e) {
        // Two students racing for the same seat: one loses the conditional update and tries the next room.
        if (e instanceof SeatTaken) continue;
        throw e;
      }
    }
    throw new ConflictException('All rooms are busy right now. Try again in a moment.');
  }

  private async takeSeat(tx: Tx, offer: DuelOffer, userId: string, source: 'EARNED_ONLY' | 'EARNED_FIRST' | 'ANY', waitMinutes: number, readySeconds: number): Promise<PaidDuelJoinResultDto> {
    const now = new Date();
    const waiting = await tx.duelRoom.findFirst({ where: { offerId: offer.id, status: 'WAITING', playerAId: { not: userId }, playerBId: null, waitingUntil: { gt: now } }, orderBy: { updatedAt: 'asc' } });
    if (waiting) {
      const claimed = await tx.duelRoom.updateMany({
        where: { id: waiting.id, status: 'WAITING', playerBId: null, playerAId: { not: userId } },
        data: { playerBId: userId, status: 'MATCHED', matchedAt: now, readyBy: new Date(now.getTime() + readySeconds * 1000), waitingUntil: null },
      });
      if (!claimed.count) throw new SeatTaken();
      const hold = await this.wallet.holdDuelEntry(tx, userId, waiting.id, waiting.cycle, waiting.entryCoins, source);
      const duel = await tx.duel.create({
        data: { mode: 'PAID', status: 'WAITING', examId: offer.examId, playerAId: waiting.playerAId!, playerBId: userId, questionCount: offer.questionCount, secondsPerQuestion: offer.secondsPerQuestion },
      });
      await tx.duelRoom.update({ where: { id: waiting.id }, data: { duelId: duel.id } });
      return { roomId: waiting.id, status: 'MATCHED', duelId: duel.id, waitingUntil: null, balanceAfter: hold.balance };
    }
    const open = await tx.duelRoom.findFirst({ where: { offerId: offer.id, status: 'OPEN' }, orderBy: { seq: 'asc' } });
    // A waiting room whose timer lapsed is reopened by the sweeper; treat it as open here too.
    const target = open ?? (await tx.duelRoom.findFirst({ where: { offerId: offer.id, status: 'WAITING', waitingUntil: { lte: now } }, orderBy: { seq: 'asc' } }));
    if (!target) throw new ConflictException('No free rooms in this duel. Try another one or come back soon.');
    const waitingUntil = new Date(now.getTime() + waitMinutes * 60_000);
    const claimed = await tx.duelRoom.updateMany({ where: { id: target.id, status: target.status, playerAId: target.playerAId }, data: { status: 'WAITING', playerAId: userId, playerBId: null, waitingUntil, cycle: { increment: 1 } } });
    if (!claimed.count) throw new SeatTaken();
    const hold = await this.wallet.holdDuelEntry(tx, userId, target.id, target.cycle + 1, target.entryCoins, source);
    return { roomId: target.id, status: 'WAITING', duelId: null, waitingUntil: waitingUntil.toISOString(), balanceAfter: hold.balance };
  }

  /** Leave a room where nobody has joined you yet: the entry comes back and the room reopens. */
  async leave(userId: string, roomId: string) {
    const done = await this.prisma.$transaction(async (tx) => {
      const room = await tx.duelRoom.findUnique({ where: { id: roomId } });
      const r = await tx.duelRoom.updateMany({ where: { id: roomId, status: 'WAITING', playerAId: userId, playerBId: null }, data: { status: 'OPEN', playerAId: null, waitingUntil: null } });
      if (!r.count || !room) return false;
      await this.wallet.refundDuelEntry(tx, userId, roomId, room.cycle, 'Left the duel before it started');
      return true;
    });
    if (!done) throw new ConflictException('You can only leave while waiting for an opponent');
    return { ok: true };
  }

  // ------------------------------------------------------------- Engine hooks

  /** The engine has started the duel. */
  markActive(roomId: string) {
    return this.prisma.duelRoom.updateMany({ where: { id: roomId, status: 'MATCHED' }, data: { status: 'ACTIVE', readyBy: null } });
  }

  roomForDuel(duelId: string) {
    return this.prisma.duelRoom.findUnique({ where: { duelId } });
  }

  /** Rooms matched but not started yet, for the engine to start once both players are online. */
  /** A matched room this student is in, so a late-connecting app still learns its duel is ready. */
  matchedRoomFor(userId: string) {
    return this.prisma.duelRoom.findFirst({ where: { status: 'MATCHED', duelId: { not: null }, OR: [{ playerAId: userId }, { playerBId: userId }] } });
  }

  matchedRooms() {
    return this.prisma.duelRoom.findMany({ where: { status: 'MATCHED', duelId: { not: null } }, take: 200 });
  }

  /**
   * Pay out from the duel's server-side result. Runs once per room (conditional update), so a retry or a second
   * instance cannot pay twice. A draw refunds both entries.
   */
  async settle(duelId: string, winner: 'A' | 'B' | 'DRAW') {
    const room = await this.prisma.duelRoom.findUnique({ where: { duelId } });
    if (!room || !room.playerAId || !room.playerBId) return null;
    const winnerId = winner === 'A' ? room.playerAId : winner === 'B' ? room.playerBId : null;
    const claimed = await this.prisma.$transaction(async (tx) => {
      const c = await tx.duelRoom.updateMany({ where: { id: room.id, status: { in: ['MATCHED', 'ACTIVE'] } }, data: { status: 'FINISHED', winnerId, settledAt: new Date() } });
      if (!c.count) return false;
      if (winnerId) await this.wallet.payDuelPrize(tx, winnerId, room.id, room.cycle, room.prizeCoins, room.entryCoins * 2);
      else {
        await this.wallet.refundDuelEntry(tx, room.playerAId!, room.id, room.cycle, 'Draw: duel entry refunded');
        await this.wallet.refundDuelEntry(tx, room.playerBId!, room.id, room.cycle, 'Draw: duel entry refunded');
      }
      return true;
    });
    if (claimed && winnerId) {
      await this.notifications.event('COINS_CREDITED', winnerId, { coins: room.prizeCoins, reason: { en: 'You won a coin duel!', hi: 'आपने कॉइन मुकाबला जीता!' } }, { link: '/wallet' }).catch(() => undefined);
    }
    return claimed ? { winnerId, prize: winnerId ? room.prizeCoins : 0 } : null;
  }

  /** Cancel a room that cannot be played and return every escrowed entry. */
  async cancelRoom(roomId: string, reason: string, actor?: AuditActor) {
    const room = await this.prisma.duelRoom.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException('Room not found');
    const result = await this.prisma.$transaction(async (tx) => {
      const c = await tx.duelRoom.updateMany({ where: { id: roomId, status: { in: ['OPEN', 'WAITING', 'MATCHED', 'ACTIVE'] } }, data: { status: 'CANCELLED', settledAt: new Date(), waitingUntil: null, readyBy: null } });
      if (!c.count) return null;
      for (const uid of [room.playerAId, room.playerBId]) if (uid) await this.wallet.refundDuelEntry(tx, uid, roomId, room.cycle, `Duel cancelled: ${reason}`);
      if (room.duelId) await tx.duel.updateMany({ where: { id: room.duelId, status: { in: ['WAITING', 'ACTIVE'] } }, data: { status: 'CANCELLED', finishedAt: new Date() } });
      return true;
    });
    if (result && actor) await this.audit.log(actor, { action: 'paidduel.room_cancel', entityType: 'DuelRoom', entityId: roomId, meta: { reason } });
    if (result) for (const uid of [room.playerAId, room.playerBId]) if (uid) await this.notifications.event('COINS_CREDITED', uid, { coins: room.entryCoins, reason: { en: 'Your duel entry was refunded.', hi: 'आपकी मुकाबला एंट्री वापस कर दी गई।' } }, { link: '/wallet' }).catch(() => undefined);
    return { ok: !!result };
  }

  /** Refund timeouts: a lone player who waited too long, a matched pair where someone never showed, an abandoned duel. */
  async sweep() {
    const now = new Date();
    const lapsed = await this.prisma.duelRoom.findMany({ where: { status: 'WAITING', waitingUntil: { lt: now } }, take: 200 });
    for (const r of lapsed) {
      await this.prisma.$transaction(async (tx) => {
        const c = await tx.duelRoom.updateMany({ where: { id: r.id, status: 'WAITING', playerBId: null }, data: { status: 'OPEN', playerAId: null, waitingUntil: null } });
        if (c.count && r.playerAId) await this.wallet.refundDuelEntry(tx, r.playerAId, r.id, r.cycle, 'No opponent joined in time');
      }).catch((e) => this.logger.error(e));
    }
    const noShow = await this.prisma.duelRoom.findMany({ where: { status: 'MATCHED', readyBy: { lt: now } }, take: 200 });
    for (const r of noShow) await this.cancelRoom(r.id, 'a player did not come online in time').catch((e) => this.logger.error(e));
    const abandoned = await this.prisma.duel.findMany({ where: { mode: 'PAID', status: { in: ['ABANDONED', 'CANCELLED'] } }, select: { id: true }, take: 200 });
    for (const d of abandoned) {
      const r = await this.prisma.duelRoom.findUnique({ where: { duelId: d.id } });
      if (r && (r.status === 'MATCHED' || r.status === 'ACTIVE')) await this.cancelRoom(r.id, 'the duel was abandoned').catch((e) => this.logger.error(e));
    }
    // A duel that finished but whose payout did not complete (crash between the two writes) is settled from its stored result.
    const unsettled = await this.prisma.duelRoom.findMany({ where: { status: { in: ['MATCHED', 'ACTIVE'] }, duelId: { not: null } }, take: 200 });
    for (const r of unsettled) {
      const d = await this.prisma.duel.findUnique({ where: { id: r.duelId! }, select: { status: true, winner: true } });
      if (d?.status === 'FINISHED' && d.winner) await this.settle(r.duelId!, d.winner as 'A' | 'B' | 'DRAW').catch((e) => this.logger.error(e));
    }
    return { reopened: lapsed.length, noShow: noShow.length };
  }

  // ------------------------------------------------------------- Admin

  async createOffer(input: PaidDuelOfferInput, actor: AuditActor) {
    const { rooms, eligibility, ...rest } = input;
    const offer = await this.prisma.$transaction(async (tx) => {
      const o = await tx.duelOffer.create({ data: { ...rest, titleHi: rest.titleHi || null, examId: rest.examId || null, eligibility: eligibility as Prisma.InputJsonValue, createdById: actor.id ?? null } });
      await tx.duelRoom.createMany({ data: Array.from({ length: rooms }, (_, i) => ({ offerId: o.id, seq: i + 1, entryCoins: o.entryCoins, prizeCoins: o.prizeCoins })) });
      return o;
    });
    await this.audit.log(actor, { action: 'paidduel.offer_create', entityType: 'DuelOffer', entityId: offer.id, after: { ...input } });
    return offer;
  }

  async updateOffer(id: string, patch: PaidDuelOfferUpdate, actor: AuditActor) {
    const offer = await this.prisma.duelOffer.findUnique({ where: { id } });
    if (!offer) throw new NotFoundException('Offer not found');
    const { addRooms, eligibility, ...rest } = patch;
    if (addRooms) {
      if (offer.status === 'CLOSED') throw new ConflictException('This offer is closed');
      const last = await this.prisma.duelRoom.aggregate({ where: { offerId: id }, _max: { seq: true } });
      const from = (last._max.seq ?? 0) + 1;
      await this.prisma.duelRoom.createMany({ data: Array.from({ length: addRooms }, (_, i) => ({ offerId: id, seq: from + i, entryCoins: offer.entryCoins, prizeCoins: offer.prizeCoins })) });
    }
    const updated = await this.prisma.duelOffer.update({ where: { id }, data: { ...rest, ...(eligibility && { eligibility: eligibility as Prisma.InputJsonValue }) } });
    if (patch.status === 'CLOSED') {
      // Closing returns every entry that is still waiting; duels already in play finish normally.
      const rooms = await this.prisma.duelRoom.findMany({ where: { offerId: id, status: { in: ['OPEN', 'WAITING'] } }, select: { id: true } });
      for (const r of rooms) await this.cancelRoom(r.id, 'this duel was closed').catch((e) => this.logger.error(e));
    }
    await this.audit.log(actor, { action: 'paidduel.offer_update', entityType: 'DuelOffer', entityId: id, before: { status: offer.status }, after: patch });
    return updated;
  }

  async adminOffers(): Promise<AdminPaidDuelOfferDto[]> {
    const offers = await this.prisma.duelOffer.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { rooms: { orderBy: { seq: 'asc' } } } });
    const userIds = [...new Set(offers.flatMap((o) => o.rooms.flatMap((r) => [r.playerAId, r.playerBId, r.winnerId])).filter(Boolean) as string[])];
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true } })).map((u) => [u.id, u.displayName]));
    const exams = new Map((await this.prisma.exam.findMany({ where: { id: { in: offers.map((o) => o.examId).filter(Boolean) as string[] } }, select: { id: true, nameEn: true, nameHi: true } })).map((e) => [e.id, { en: e.nameEn, hi: e.nameHi ?? e.nameEn }]));
    return offers.map((o) => {
      const n = (s: string) => o.rooms.filter((r) => r.status === s).length;
      const heldEntries = (r: DuelRoom) => (r.playerAId ? 1 : 0) + (r.playerBId ? 1 : 0);
      return {
        id: o.id, titleEn: o.titleEn, titleHi: o.titleHi, entryCoins: o.entryCoins, prizeCoins: o.prizeCoins, feeCoins: o.entryCoins * 2 - o.prizeCoins,
        questionCount: o.questionCount, secondsPerQuestion: o.secondsPerQuestion, examName: o.examId ? exams.get(o.examId) ?? null : null,
        openRooms: n('OPEN'), waitingRooms: n('WAITING'), playingRooms: n('MATCHED') + n('ACTIVE'), finishedRooms: n('FINISHED'), cancelledRooms: n('CANCELLED'),
        status: o.status, examId: o.examId, eligibility: (o.eligibility ?? {}) as Eligibility, createdAt: o.createdAt.toISOString(),
        escrowCoins: o.rooms.filter((r) => (IN_PLAY as readonly string[]).includes(r.status)).reduce((s, r) => s + heldEntries(r) * r.entryCoins, 0),
        feesCoins: o.rooms.filter((r) => r.status === 'FINISHED' && r.winnerId).reduce((s, r) => s + r.entryCoins * 2 - r.prizeCoins, 0),
        rooms: o.rooms.map((r) => ({ id: r.id, seq: r.seq, status: r.status, playerA: r.playerAId ? users.get(r.playerAId) ?? '—' : null, playerB: r.playerBId ? users.get(r.playerBId) ?? '—' : null, winner: r.winnerId ? users.get(r.winnerId) ?? '—' : null, waitingUntil: r.waitingUntil?.toISOString() ?? null })),
      };
    });
  }
}

class SeatTaken extends Error {}
