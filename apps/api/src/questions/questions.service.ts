import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AdminUser, type QuestionStatus } from '@prisma/client';
import { hasPermission, type QuestionInput } from '@testwise/shared';
import { AuditService, type AuditActor } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';

export const questionInclude = {
  options: { orderBy: { sortOrder: 'asc' } },
  exam: { select: { id: true, slug: true, nameEn: true } },
  subject: { select: { id: true, slug: true, nameEn: true } },
  topic: { select: { id: true, slug: true, nameEn: true } },
} satisfies Prisma.QuestionInclude;

export type QuestionWithRelations = Prisma.QuestionGetPayload<{ include: typeof questionInclude }>;

export interface QuestionFilters {
  q?: string;
  status?: QuestionStatus;
  examId?: string;
  subjectId?: string;
  topicId?: string;
  difficulty?: string;
  type?: string;
  importBatchId?: string;
  missingHindi?: boolean;
  page: number;
  pageSize: number;
}

type Tx = Prisma.TransactionClient;

/** Fields copied into a question row from validated input (options handled separately). */
export function questionData(input: QuestionInput) {
  return {
    refId: input.refId || null,
    type: input.type,
    difficulty: input.difficulty,
    examId: input.examId || null,
    subjectId: input.subjectId,
    topicId: input.topicId || null,
    classLevel: input.classLevel ?? null,
    textEn: input.textEn,
    textHi: input.textHi || null,
    solutionEn: input.solutionEn || null,
    solutionHi: input.solutionHi || null,
    imageUrl: input.imageUrl || null,
    solutionImageUrl: input.solutionImageUrl || null,
    correctLabels: input.type === 'NUMERIC' ? [] : input.correctLabels,
    correctNumeric: input.type === 'NUMERIC' ? input.correctNumeric ?? null : null,
    numericTolerance: input.type === 'NUMERIC' ? input.numericTolerance ?? null : null,
    marks: input.marks,
    negativeMarks: input.negativeMarks,
    tags: input.tags,
    source: input.source || null,
    licence: input.licence || null,
  };
}

export function optionRows(input: QuestionInput) {
  if (input.type === 'NUMERIC') return [];
  return input.options.map((o, i) => ({ label: o.label, textEn: o.textEn, textHi: o.textHi || null, sortOrder: i }));
}

/** Plain JSON snapshot of a question for version history. */
export function snapshot(q: QuestionWithRelations | Prisma.QuestionGetPayload<{ include: { options: true } }>) {
  return JSON.parse(JSON.stringify(q)) as Prisma.InputJsonValue;
}

@Injectable()
export class QuestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(f: QuestionFilters) {
    const where: Prisma.QuestionWhereInput = {
      ...(f.status && { status: f.status }),
      ...(f.examId && { examId: f.examId }),
      ...(f.subjectId && { subjectId: f.subjectId }),
      ...(f.topicId && { topicId: f.topicId }),
      ...(f.difficulty && { difficulty: f.difficulty as Prisma.EnumDifficultyFilter['equals'] }),
      ...(f.type && { type: f.type as Prisma.EnumQuestionTypeFilter['equals'] }),
      ...(f.importBatchId && { importBatchId: f.importBatchId }),
      ...(f.missingHindi && { textHi: null }),
      ...(f.q && {
        OR: [
          { textEn: { contains: f.q, mode: 'insensitive' } },
          { textHi: { contains: f.q, mode: 'insensitive' } },
          { refId: { contains: f.q, mode: 'insensitive' } },
          { tags: { has: f.q } },
        ],
      }),
    };
    const [items, total] = await Promise.all([
      this.prisma.question.findMany({
        where,
        include: questionInclude,
        orderBy: { updatedAt: 'desc' },
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
      }),
      this.prisma.question.count({ where }),
    ]);
    return { items, total, page: f.page, pageSize: f.pageSize };
  }

  async get(id: string) {
    const q = await this.prisma.question.findUnique({
      where: { id },
      include: { ...questionInclude, versions: { orderBy: { version: 'desc' }, select: { id: true, version: true, changedById: true, createdAt: true } } },
    });
    if (!q) throw new NotFoundException('Question not found');
    return q;
  }

  async assertRefs(input: Pick<QuestionInput, 'examId' | 'subjectId' | 'topicId'>, tx: Tx | PrismaService = this.prisma) {
    const [subject, exam, topic] = await Promise.all([
      tx.subject.findUnique({ where: { id: input.subjectId } }),
      input.examId ? tx.exam.findUnique({ where: { id: input.examId } }) : Promise.resolve(true),
      input.topicId ? tx.topic.findUnique({ where: { id: input.topicId } }) : Promise.resolve(null),
    ]);
    if (!subject) throw new BadRequestException('Unknown subject');
    if (!exam) throw new BadRequestException('Unknown exam');
    if (input.topicId && (!topic || topic.subjectId !== input.subjectId)) {
      throw new BadRequestException('Topic does not belong to the selected subject');
    }
  }

  async create(input: QuestionInput, actor: AuditActor) {
    await this.assertRefs(input);
    if (input.refId && (await this.prisma.question.findUnique({ where: { refId: input.refId } }))) {
      throw new ConflictException(`ref_id ${input.refId} already exists`);
    }
    const q = await this.prisma.$transaction(async (tx) => {
      const created = await tx.question.create({
        data: { ...questionData(input), createdById: actor.id, options: { create: optionRows(input) } },
        include: questionInclude,
      });
      await this.audit.log(actor, { action: 'question.create', entityType: 'Question', entityId: created.id, after: snapshot(created) }, tx);
      return created;
    });
    return q;
  }

  /** Edits snapshot the previous version. Editing an approved question sends it back to review. */
  async update(id: string, input: QuestionInput, actor: AuditActor) {
    await this.assertRefs(input);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.question.findUnique({ where: { id }, include: questionInclude });
      if (!before) throw new NotFoundException('Question not found');
      if (before.status === 'RETIRED') throw new ConflictException('Retired questions cannot be edited; reopen first');
      if (input.refId && input.refId !== before.refId) {
        const clash = await tx.question.findUnique({ where: { refId: input.refId } });
        if (clash) throw new ConflictException(`ref_id ${input.refId} already exists`);
      }
      await tx.questionVersion.create({
        data: { questionId: id, version: before.version, snapshot: snapshot(before), changedById: actor.id },
      });
      await tx.questionOption.deleteMany({ where: { questionId: id } });
      const after = await tx.question.update({
        where: { id },
        data: {
          ...questionData(input),
          version: before.version + 1,
          status: before.status === 'APPROVED' ? 'IN_REVIEW' : before.status,
          options: { create: optionRows(input) },
        },
        include: questionInclude,
      });
      await this.audit.log(actor, { action: 'question.update', entityType: 'Question', entityId: id, before: snapshot(before), after: snapshot(after) }, tx);
      return after;
    });
  }

  async review(id: string, action: 'SUBMIT' | 'APPROVE' | 'REJECT' | 'RETIRE' | 'REOPEN', note: string | undefined, admin: AdminUser, actor: AuditActor) {
    const q = await this.prisma.question.findUnique({ where: { id } });
    if (!q) throw new NotFoundException('Question not found');
    const rules: Record<typeof action, { from: QuestionStatus[]; to: QuestionStatus; review?: boolean }> = {
      SUBMIT: { from: ['DRAFT', 'REJECTED'], to: 'IN_REVIEW' },
      APPROVE: { from: ['IN_REVIEW', 'DRAFT'], to: 'APPROVED', review: true },
      REJECT: { from: ['IN_REVIEW'], to: 'REJECTED', review: true },
      RETIRE: { from: ['APPROVED'], to: 'RETIRED', review: true },
      REOPEN: { from: ['RETIRED', 'REJECTED'], to: 'DRAFT' },
    };
    const rule = rules[action];
    if (!rule.from.includes(q.status)) throw new ConflictException(`Cannot ${action.toLowerCase()} a ${q.status} question`);
    if (rule.review && !hasPermission(admin.role, 'content.review')) throw new ForbiddenException('Reviewer permission required');
    // Segregation of duties: authors cannot approve their own questions (super admins exempt).
    if (action === 'APPROVE' && q.createdById === admin.id && admin.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('A different reviewer must approve questions you created');
    }
    if (action === 'REJECT' && !note) throw new BadRequestException('A note is required when rejecting');
    const updated = await this.prisma.question.update({
      where: { id },
      data: {
        status: rule.to,
        reviewNote: note ?? null,
        ...(rule.review && { reviewedById: admin.id, reviewedAt: new Date() }),
      },
      include: questionInclude,
    });
    await this.audit.log(actor, {
      action: `question.${action.toLowerCase()}`,
      entityType: 'Question',
      entityId: id,
      before: { status: q.status },
      after: { status: rule.to },
      meta: note ? { note } : undefined,
    });
    return updated;
  }

  async bulkReview(ids: string[], action: 'SUBMIT' | 'APPROVE' | 'REJECT' | 'RETIRE' | 'REOPEN', note: string | undefined, admin: AdminUser, actor: AuditActor) {
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of ids.slice(0, 500)) {
      try {
        await this.review(id, action, note, admin, actor);
        results.push({ id, ok: true });
      } catch (e) {
        results.push({ id, ok: false, error: e instanceof Error ? e.message : 'failed' });
      }
    }
    return { ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) };
  }

  async remove(id: string, actor: AuditActor) {
    const q = await this.prisma.question.findUnique({ where: { id }, include: questionInclude });
    if (!q) throw new NotFoundException('Question not found');
    if (!['DRAFT', 'REJECTED'].includes(q.status)) throw new ConflictException('Only draft or rejected questions can be deleted; retire it instead');
    await this.prisma.$transaction(async (tx) => {
      await tx.question.delete({ where: { id } });
      await this.audit.log(actor, { action: 'question.delete', entityType: 'Question', entityId: id, before: snapshot(q) }, tx);
    });
    return { ok: true };
  }

  async version(id: string, version: number) {
    const v = await this.prisma.questionVersion.findUnique({ where: { questionId_version: { questionId: id, version } } });
    if (!v) throw new NotFoundException('Version not found');
    return v;
  }
}
