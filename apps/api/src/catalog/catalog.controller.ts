import { Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { examSchema, Permission, subjectSchema, topicSchema } from '@testwise/shared';
import type { z } from 'zod';
import { AdminActor, AdminAuthGuard, RequirePermission } from '../common/auth.guards';
import { AuditService, type AuditActor } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod.pipe';

const examPublicSelect = { id: true, slug: true, nameEn: true, nameHi: true, category: true, icon: true, color: true } as const;

@Controller('v1/catalog')
export class CatalogController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('exams')
  exams() {
    return this.prisma.exam.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }], select: examPublicSelect });
  }
}

function uniqueGuard(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Slug already in use');
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new NotFoundException();
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
    throw new ConflictException('This item is in use and cannot be deleted');
  }
  throw e;
}

@Controller('v1/admin/taxonomy')
@UseGuards(AdminAuthGuard)
export class AdminTaxonomyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission(Permission.CONTENT_READ)
  async all() {
    const [exams, subjects] = await Promise.all([
      this.prisma.exam.findMany({ orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }], include: { _count: { select: { questions: true } } } }),
      this.prisma.subject.findMany({ orderBy: { nameEn: 'asc' }, include: { topics: { orderBy: { nameEn: 'asc' } }, _count: { select: { questions: true } } } }),
    ]);
    return { exams, subjects };
  }

  // Exams
  @Post('exams')
  @RequirePermission(Permission.CONTENT_WRITE)
  async createExam(@Body(new ZodPipe(examSchema)) body: z.infer<typeof examSchema>, @AdminActor() actor: AuditActor) {
    const exam = await this.prisma.exam.create({ data: body }).catch(uniqueGuard);
    await this.audit.log(actor, { action: 'exam.create', entityType: 'Exam', entityId: exam.id, after: exam });
    return exam;
  }

  @Put('exams/:id')
  @RequirePermission(Permission.CONTENT_WRITE)
  async updateExam(@Param('id') id: string, @Body(new ZodPipe(examSchema)) body: z.infer<typeof examSchema>, @AdminActor() actor: AuditActor) {
    const before = await this.prisma.exam.findUnique({ where: { id } });
    const exam = await this.prisma.exam.update({ where: { id }, data: body }).catch(uniqueGuard);
    await this.audit.log(actor, { action: 'exam.update', entityType: 'Exam', entityId: id, before, after: exam });
    return exam;
  }

  // Subjects
  @Post('subjects')
  @RequirePermission(Permission.CONTENT_WRITE)
  async createSubject(@Body(new ZodPipe(subjectSchema)) body: z.infer<typeof subjectSchema>, @AdminActor() actor: AuditActor) {
    const subject = await this.prisma.subject.create({ data: body }).catch(uniqueGuard);
    await this.audit.log(actor, { action: 'subject.create', entityType: 'Subject', entityId: subject.id, after: subject });
    return subject;
  }

  @Put('subjects/:id')
  @RequirePermission(Permission.CONTENT_WRITE)
  async updateSubject(@Param('id') id: string, @Body(new ZodPipe(subjectSchema)) body: z.infer<typeof subjectSchema>, @AdminActor() actor: AuditActor) {
    const subject = await this.prisma.subject.update({ where: { id }, data: body }).catch(uniqueGuard);
    await this.audit.log(actor, { action: 'subject.update', entityType: 'Subject', entityId: id, after: subject });
    return subject;
  }

  @Delete('subjects/:id')
  @RequirePermission(Permission.CONTENT_WRITE)
  async deleteSubject(@Param('id') id: string, @AdminActor() actor: AuditActor) {
    await this.prisma.subject.delete({ where: { id } }).catch(uniqueGuard);
    await this.audit.log(actor, { action: 'subject.delete', entityType: 'Subject', entityId: id });
    return { ok: true };
  }

  // Topics
  @Post('topics')
  @RequirePermission(Permission.CONTENT_WRITE)
  async createTopic(@Body(new ZodPipe(topicSchema)) body: z.infer<typeof topicSchema>, @AdminActor() actor: AuditActor) {
    const topic = await this.prisma.topic.create({ data: body }).catch(uniqueGuard);
    await this.audit.log(actor, { action: 'topic.create', entityType: 'Topic', entityId: topic.id, after: topic });
    return topic;
  }

  @Delete('topics/:id')
  @RequirePermission(Permission.CONTENT_WRITE)
  async deleteTopic(@Param('id') id: string, @AdminActor() actor: AuditActor) {
    await this.prisma.topic.delete({ where: { id } }).catch(uniqueGuard);
    await this.audit.log(actor, { action: 'topic.delete', entityType: 'Topic', entityId: id });
    return { ok: true };
  }

  @Get('topics')
  @RequirePermission(Permission.CONTENT_READ)
  topics(@Query('subjectId') subjectId: string) {
    return this.prisma.topic.findMany({ where: { subjectId }, orderBy: { nameEn: 'asc' } });
  }
}
