import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { FlagSeverity } from '@testwise/shared';
import { FLAG_TYPES } from '@testwise/shared';
import type { FrozenPaper } from '../attempts/scoring';
import { PrismaService } from '../common/prisma.service';
import { RedisService } from '../common/redis.service';
import { TtlCache } from '../common/ttl-cache';
import { AppConfigService } from '../app-config/app-config.service';
import { findCollusion, timingAnomalies, type AttemptRow, type QuestionMeta } from './answer-patterns';
import { ProctoringService } from './proctoring.service';

const FINISHED = ['SUBMITTED', 'AUTO_SUBMITTED'] as const;
/** Significance level: the chance two independent students share this many wrong answers must be below this. */
const MAX_P_VALUE = 1e-4;

@Injectable()
export class AnswerAnalysisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('AnswerAnalysis');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
    private readonly proctoring: ProctoringService,
  ) {}

  /** Per-test answer statistics: one scan of the cohort per minute instead of one per analysed attempt. */
  private readonly cohorts = new TtlCache(60_000, 50);
  /** Finished attempts of a tournament, reused for later attempts only if loaded after they were submitted (so no near-simultaneous pair is skipped). */
  private readonly peers = new Map<string, { loadedAt: number; rows: AttemptRow[] }>();

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    // Analysis is O(finishers) per attempt: on a scaled deployment run it on one dedicated worker (ANSWER_ANALYSIS_ENABLED=true) and set false on HTTP replicas.
    if (process.env.ANSWER_ANALYSIS_ENABLED === 'false') return;
    this.timer = setInterval(() => void this.redis.withLock('job:answer-analysis', 120_000, () => this.sweep()).catch((e) => this.logger.error(e)), 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private toRow(a: { id: string; userId: string; answers: { questionId: string; selectedLabels: string[]; numericValue: number | null; isCorrect: boolean | null; timeSpentSec: number; changeCount: number }[] }): AttemptRow {
    return { attemptId: a.id, userId: a.userId, answers: a.answers.map((x) => ({ questionId: x.questionId, labels: x.selectedLabels, numericValue: x.numericValue, isCorrect: x.isCorrect, timeSpentSec: x.timeSpentSec, changeCount: x.changeCount })) };
  }

  private meta(paper: FrozenPaper) {
    return new Map<string, QuestionMeta>(paper.questions.map((q) => [q.id, { optionCount: q.options.length, type: q.type }]));
  }

  /** Analyse recently submitted attempts that have not been analysed yet. */
  async sweep() {
    const since = new Date(Date.now() - 6 * 3600_000);
    const todo = await this.prisma.attempt.findMany({
      where: { status: { in: [...FINISHED] }, submittedAt: { gte: since }, events: { none: { type: 'ANSWER_ANALYSED' } } },
      select: { id: true },
      orderBy: { submittedAt: 'asc' },
      take: 200,
    });
    for (const { id } of todo) await this.analyseAttempt(id).catch((e) => this.logger.error(`analyse ${id}: ${(e as Error).message}`));
    return todo.length;
  }

  /** Timing checks for one attempt, and collusion against every earlier finisher of the same tournament. */
  async analyseAttempt(attemptId: string) {
    const policy = await this.config.get('proctoring.policy');
    const a = await this.prisma.attempt.findUnique({ where: { id: attemptId }, include: { answers: true } });
    if (!a || !FINISHED.includes(a.status as (typeof FINISHED)[number])) return { findings: 0 };
    const row = this.toRow(a);
    const paper = a.paper as unknown as FrozenPaper;
    let findings = 0;

    const cohort = await this.cohorts.get(a.testId, () =>
      this.prisma.attemptAnswer.groupBy({ by: ['questionId', 'isCorrect'], where: { attempt: { testId: a.testId, status: { in: [...FINISHED] } }, isCorrect: { not: null } }, _count: true }),
    );
    const rate = new Map<string, number>();
    for (const q of new Set(cohort.map((c) => c.questionId))) {
      const right = cohort.find((c) => c.questionId === q && c.isCorrect)?._count ?? 0;
      const wrong = cohort.find((c) => c.questionId === q && !c.isCorrect)?._count ?? 0;
      if (right + wrong >= 20) rate.set(q, right / (right + wrong)); // ignore questions with too little data
    }
    for (const t of timingAnomalies(row, rate, { minSecondsPerAnswer: policy.minSecondsPerAnswer })) {
      await this.report(a.id, a.userId, t.type, t.confidence, { reasons: t.reasons });
      findings++;
    }

    if (a.tournamentId) {
      const others = await this.peersOf(a.tournamentId, a.submittedAt?.getTime() ?? Date.now(), a.id);
      const hits = findCollusion([row, ...others], this.meta(paper), { minShared: policy.collusionMinSharedWrong, minRatio: policy.collusionMinRatio, maxPValue: MAX_P_VALUE })
        .filter((h) => h.a === a.id || h.b === a.id);
      for (const h of hits) {
        const peer = h.a === a.id ? h : { ...h, a: h.b, b: h.a };
        // Never reveal the other student's identity to the student; reviewers see it through the peer attempt id.
        await this.report(a.id, a.userId, 'ANSWER_COLLUSION', Math.min(1, 1 - h.pValue), {
          reasons: [`${h.sharedWrong} identical wrong answers out of ${h.bothWrong} questions both got wrong (chance ≈ ${h.pValue.toExponential(1)})`],
          peerAttemptId: peer.b, sharedWrong: h.sharedWrong,
        });
        findings++;
      }
    }
    await this.prisma.attemptEvent.create({ data: { attemptId: a.id, type: 'ANSWER_ANALYSED', meta: { findings }, riskPoints: 0 } });
    return { findings };
  }

  private async peersOf(tournamentId: string, submittedAtMs: number, exceptAttemptId: string): Promise<AttemptRow[]> {
    let entry = this.peers.get(tournamentId);
    if (!entry || entry.loadedAt < submittedAtMs) {
      const loadedAt = Date.now();
      // `omit` keeps the large frozen paper out of every row (it is not needed to compare answers).
      const all = await this.prisma.attempt.findMany({ where: { tournamentId, status: { in: [...FINISHED] } }, omit: { paper: true }, include: { answers: true } });
      entry = { loadedAt, rows: all.map((o) => this.toRow(o)) };
      if (this.peers.size >= 3) this.peers.clear();
      this.peers.set(tournamentId, entry);
    }
    return entry.rows.filter((r) => r.attemptId !== exceptAttemptId);
  }

  /** Re-run for a whole tournament, e.g. after changing thresholds. */
  async analyseTournament(tournamentId: string) {
    const ids = await this.prisma.attempt.findMany({ where: { tournamentId, status: { in: [...FINISHED] } }, select: { id: true } });
    let findings = 0;
    for (const { id } of ids) findings += (await this.analyseAttempt(id)).findings;
    return { attempts: ids.length, findings };
  }

  private async report(attemptId: string, userId: string, type: 'ANSWER_COLLUSION' | 'ANSWER_TIMING' | 'ANSWER_SPEED', confidence: number, details: { reasons: string[]; peerAttemptId?: string; sharedWrong?: number }) {
    const session = await this.prisma.proctorSession.findUnique({ where: { attemptId } });
    const info = FLAG_TYPES[type];
    if (session) {
      const dup = await this.prisma.proctorFlag.findFirst({
        where: { sessionId: session.id, type, ...(details.peerAttemptId && { details: { path: ['peerAttemptId'], equals: details.peerAttemptId } }) },
      });
      if (dup) return;
      // Ended sessions still accept server flags; raise() skips only the live warning/termination path.
      await this.proctoring.raise(session, { type, source: 'SERVER', confidence, message: details.reasons[0] ?? null, details, evidence: [], severity: info.severity as FlagSeverity });
      return;
    }
    // Attempt without a proctoring session: keep the signal in the integrity ledger so reviewers still see it.
    const exists = await this.prisma.attemptEvent.findFirst({ where: { attemptId, type, ...(details.peerAttemptId && { meta: { path: ['peerAttemptId'], equals: details.peerAttemptId } }) } });
    if (!exists) await this.prisma.attemptEvent.create({ data: { attemptId, type, meta: { ...details, confidence, userId }, riskPoints: info.points } });
  }
}
