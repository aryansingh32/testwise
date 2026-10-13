import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import type { AdminUser, QuestionStatus } from '@prisma/client';
import { Permission, questionReviewSchema, questionSchema, type QuestionInput } from '@testwise/shared';
import type { Response } from 'express';
import { parsePaging } from '../common/pagination';
import { z } from 'zod';
import { AdminActor, AdminAuthGuard, CurrentAdmin, RequirePermission } from '../common/auth.guards';
import type { AuditActor } from '../common/audit.service';
import { StorageService } from '../common/storage.service';
import { ZodPipe } from '../common/zod.pipe';
import { ImportService } from './import.service';
import { QuestionsService } from './questions.service';

type UploadedBlob = { originalname: string; buffer: Buffer; size: number };

const bulkReviewSchema = questionReviewSchema.extend({ ids: z.array(z.string()).min(1).max(500) });

@Controller('v1/admin/questions')
@UseGuards(AdminAuthGuard)
export class AdminQuestionsController {
  constructor(
    private readonly questions: QuestionsService,
    private readonly imports: ImportService,
    private readonly storage: StorageService,
  ) {}

  // ----- Bulk import (declared before :id routes)

  @Get('import/template')
  @RequirePermission(Permission.CONTENT_WRITE)
  async template(@Query('format') format: string, @Res() res: Response) {
    const fmt = format === 'csv' ? 'csv' : 'xlsx';
    const buf = await this.imports.template(fmt);
    res.setHeader(
      'Content-Type',
      fmt === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="testwise-questions-template.${fmt}"`);
    res.send(buf);
  }

  @Get('import')
  @RequirePermission(Permission.CONTENT_READ)
  importList() {
    return this.imports.list();
  }

  @Get('import/:id')
  @RequirePermission(Permission.CONTENT_READ)
  importGet(@Param('id') id: string) {
    return this.imports.get(id);
  }

  @Post('import/validate')
  @RequirePermission(Permission.CONTENT_WRITE)
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'file', maxCount: 1 }, { name: 'images', maxCount: 1 }], {
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  importValidate(@UploadedFiles() files: { file?: UploadedBlob[]; images?: UploadedBlob[] }, @AdminActor() actor: AuditActor) {
    const file = files?.file?.[0];
    if (!file) throw new BadRequestException('Attach the question sheet as "file"');
    return this.imports.validate(file, files.images?.[0], actor);
  }

  @Post('import/:id/commit')
  @RequirePermission(Permission.CONTENT_WRITE)
  importCommit(@Param('id') id: string, @AdminActor() actor: AuditActor) {
    return this.imports.commit(id, actor);
  }

  @Post('import/:id/rollback')
  @RequirePermission(Permission.CONTENT_WRITE)
  importRollback(@Param('id') id: string, @AdminActor() actor: AuditActor) {
    return this.imports.rollback(id, actor);
  }

  // ----- Images for the manual editor

  @Post('images')
  @RequirePermission(Permission.CONTENT_WRITE)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadImage(@UploadedFile() file: UploadedBlob | undefined) {
    if (!file) throw new BadRequestException('Attach an image as "file"');
    return { url: await this.storage.saveImage(file.originalname, file.buffer, 'questions') };
  }

  // ----- CRUD & review

  @Get()
  @RequirePermission(Permission.CONTENT_READ)
  list(
    @Query('q') q?: string,
    @Query('status') status?: QuestionStatus,
    @Query('examId') examId?: string,
    @Query('subjectId') subjectId?: string,
    @Query('topicId') topicId?: string,
    @Query('difficulty') difficulty?: string,
    @Query('type') type?: string,
    @Query('importBatchId') importBatchId?: string,
    @Query('missingHindi') missingHindi?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.questions.list({
      q, status, examId, subjectId, topicId, difficulty, type, importBatchId,
      missingHindi: missingHindi === 'true',
      ...(({ page: pg, pageSize: size }) => ({ page: pg, pageSize: size }))(parsePaging(page, pageSize)),
    });
  }

  @Post('review')
  @RequirePermission(Permission.CONTENT_WRITE)
  bulkReview(@Body(new ZodPipe(bulkReviewSchema)) body: z.infer<typeof bulkReviewSchema>, @CurrentAdmin() admin: AdminUser, @AdminActor() actor: AuditActor) {
    return this.questions.bulkReview(body.ids, body.action, body.note, admin, actor);
  }

  @Get(':id')
  @RequirePermission(Permission.CONTENT_READ)
  get(@Param('id') id: string) {
    return this.questions.get(id);
  }

  @Get(':id/versions/:version')
  @RequirePermission(Permission.CONTENT_READ)
  version(@Param('id') id: string, @Param('version', ParseIntPipe) version: number) {
    return this.questions.version(id, version);
  }

  @Post()
  @RequirePermission(Permission.CONTENT_WRITE)
  create(@Body(new ZodPipe(questionSchema)) body: QuestionInput, @AdminActor() actor: AuditActor) {
    return this.questions.create(body, actor);
  }

  @Put(':id')
  @RequirePermission(Permission.CONTENT_WRITE)
  update(@Param('id') id: string, @Body(new ZodPipe(questionSchema)) body: QuestionInput, @AdminActor() actor: AuditActor) {
    return this.questions.update(id, body, actor);
  }

  @Post(':id/review')
  @RequirePermission(Permission.CONTENT_WRITE)
  review(
    @Param('id') id: string,
    @Body(new ZodPipe(questionReviewSchema)) body: z.infer<typeof questionReviewSchema>,
    @CurrentAdmin() admin: AdminUser,
    @AdminActor() actor: AuditActor,
  ) {
    return this.questions.review(id, body.action, body.note, admin, actor);
  }

  @Delete(':id')
  @RequirePermission(Permission.CONTENT_WRITE)
  remove(@Param('id') id: string, @AdminActor() actor: AuditActor) {
    return this.questions.remove(id, actor);
  }
}
