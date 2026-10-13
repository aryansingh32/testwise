import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, TestStatus } from '@prisma/client';
import type { TestInput } from '@testwise/shared';
import type { z } from 'zod';
import type { assembleSchema } from '@testwise/shared';
import { AuditService, type AuditActor } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { seededShuffle } from '../attempts/scoring';

const detailInclude = {
  exam: { select: { id: true, nameEn: true } },
  sections: {
    orderBy: { sortOrder: 'asc' },
    include: {
      questions: {
        orderBy: { sortOrder: 'asc' },
        include: {
          question: {
            select: {
              id: true, refId: true, textEn: true, textHi: true, type: true, difficulty: true, status: true, marks: true, negativeMarks: true,
              subject: { select: { nameEn: true } }, topic: { select: { nameEn: true } },
            },
          },
        },
      },
    },
  },
  series: { include: { series: { select: { id: true, titleEn: true, slug: true } } } },
  tournaments: { select: { id: true, titleEn: true, status: true } },
  _count: { select: { attempts: true } },
} satisfies Prisma.TestInclude;

@Injectable()
export class TestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(params: { status?: TestStatus; q?: string; kind?: string }) {
    const tests = await this.prisma.test.findMany({
      where: {
        ...(params.status && { status: params.status }),
        ...(params.kind && { kind: params.kind as never }),
        ...(params.q && { titleEn: { contains: params.q, mode: 'insensitive' } }),
      },
      orderBy: { updatedAt: 'desc' },
      include: { exam: { select: { nameEn: true } }, _count: { select: { questions: true, attempts: true } } },
      take: 300,
    });
    return tests;
  }

  async get(id: string) {
    const t = await this.prisma.test.findUnique({ where: { id }, include: detailInclude });
    if (!t) throw new NotFoundException('Test not found');
    return t;
  }

  private async assertEditable(id: string) {
    const t = await this.prisma.test.findUnique({ where: { id }, include: { _count: { select: { attempts: true } } } });
    if (!t) throw new NotFoundException('Test not found');
    if (t._count.attempts > 0) throw new ConflictException('Students have already attempted this test. Duplicate it to make changes.');
    return t;
  }

  private async writeSections(tx: Prisma.TransactionClient, testId: string, input: TestInput) {
    const ids = input.sections.flatMap((s) => s.questions.map((q) => q.questionId));
    if (new Set(ids).size !== ids.length) throw new BadRequestException('A question appears more than once in this test');
    const found = await tx.question.count({ where: { id: { in: ids } } });
    if (found !== ids.length) throw new BadRequestException('Some questions no longer exist');
    await tx.testSection.deleteMany({ where: { testId } });
    for (const [si, s] of input.sections.entries()) {
      const section = await tx.testSection.create({ data: { testId, titleEn: s.titleEn, titleHi: s.titleHi || null, sortOrder: si } });
      if (s.questions.length) {
        await tx.testQuestion.createMany({
          data: s.questions.map((q, qi) => ({
            testId, sectionId: section.id, questionId: q.questionId, sortOrder: qi, marks: q.marks ?? null, negativeMarks: q.negativeMarks ?? null,
          })),
        });
      }
    }
  }

  private fields(input: TestInput) {
    const { sections: _s, ...rest } = input;
    return { ...rest, examId: rest.examId || null, titleHi: rest.titleHi || null };
  }

  async create(input: TestInput, actor: AuditActor) {
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.test.create({ data: { ...this.fields(input), createdById: actor.id } });
      await this.writeSections(tx, t.id, input);
      await this.audit.log(actor, { action: 'test.create', entityType: 'Test', entityId: t.id, after: input }, tx);
      return t;
    });
  }

  async update(id: string, input: TestInput, actor: AuditActor) {
    await this.assertEditable(id);
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.test.update({ where: { id }, data: this.fields(input) });
      await this.writeSections(tx, id, input);
      await this.audit.log(actor, { action: 'test.update', entityType: 'Test', entityId: id, after: input }, tx);
      return t;
    });
  }

  /** Publishing requires every question to be approved, so students only see reviewed content. */
  async setStatus(id: string, status: TestStatus, actor: AuditActor) {
    const t = await this.get(id);
    if (status === 'PUBLISHED') {
      const qs = t.sections.flatMap((s) => s.questions);
      if (!qs.length) throw new BadRequestException('Add questions before publishing');
      const unapproved = qs.filter((q) => q.question.status !== 'APPROVED');
      if (unapproved.length) {
        throw new BadRequestException({
          message: `${unapproved.length} question(s) are not approved yet`,
          issues: unapproved.slice(0, 20).map((q) => q.question.refId ?? q.question.textEn.slice(0, 60)),
        });
      }
    }
    if (status === 'ARCHIVED' && t.tournaments.some((x) => ['SCHEDULED', 'REG_OPEN', 'REG_CLOSED', 'LIVE'].includes(x.status))) {
      throw new ConflictException('An active tournament uses this test');
    }
    const updated = await this.prisma.test.update({
      where: { id },
      data: { status, ...(status === 'PUBLISHED' && !t.publishedAt && { publishedAt: new Date() }) },
    });
    await this.audit.log(actor, { action: `test.${status.toLowerCase()}`, entityType: 'Test', entityId: id, before: { status: t.status }, after: { status } });
    return updated;
  }

  async duplicate(id: string, actor: AuditActor) {
    const t = await this.get(id);
    const input: TestInput = {
      titleEn: `${t.titleEn} (copy)`, titleHi: t.titleHi, instructionsEn: t.instructionsEn, instructionsHi: t.instructionsHi, examId: t.examId,
      kind: t.kind, durationMinutes: t.durationMinutes, shuffleQuestions: t.shuffleQuestions, shuffleOptions: t.shuffleOptions,
      allowLanguageSwitch: t.allowLanguageSwitch, answerKeyPolicy: t.answerKeyPolicy, maxAttempts: t.maxAttempts, proctorMode: t.proctorMode, proctorOptions: t.proctorOptions as TestInput['proctorOptions'],
      sections: t.sections.map((s) => ({ titleEn: s.titleEn, titleHi: s.titleHi, questions: s.questions.map((q) => ({ questionId: q.questionId, marks: q.marks, negativeMarks: q.negativeMarks })) })),
    };
    return this.create(input, actor);
  }

  async remove(id: string, actor: AuditActor) {
    const t = await this.assertEditable(id);
    const used = await this.prisma.test.findUnique({ where: { id }, include: { series: true, tournaments: true } });
    if (used!.series.length || used!.tournaments.length) throw new ConflictException('Remove this test from series and tournaments first');
    await this.prisma.test.delete({ where: { id } });
    await this.audit.log(actor, { action: 'test.delete', entityType: 'Test', entityId: id, before: { titleEn: t.titleEn } });
    return { ok: true };
  }

  /** Pick random approved questions matching filters, for the builder's auto-assemble. */
  async assemble(input: z.infer<typeof assembleSchema>) {
    const pool = await this.prisma.question.findMany({
      where: {
        status: 'APPROVED',
        id: { notIn: input.excludeIds },
        ...(input.examId && { examId: input.examId }),
        ...(input.subjectId && { subjectId: input.subjectId }),
        ...(input.topicId && { topicId: input.topicId }),
        ...(input.difficulty && { difficulty: input.difficulty }),
      },
      select: { id: true, refId: true, textEn: true, type: true, difficulty: true, marks: true, negativeMarks: true, subject: { select: { nameEn: true } } },
      take: 2000,
    });
    const picked = seededShuffle(pool, `${Date.now()}`).slice(0, input.count);
    return { available: pool.length, picked };
  }
}
