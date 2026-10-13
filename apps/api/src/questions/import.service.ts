import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OPTION_LABELS, QUESTION_IMPORT_COLUMNS, questionSchema, type QuestionInput } from '@testwise/shared';
import AdmZip from 'adm-zip';
import ExcelJS from 'exceljs';
import { basename, extname } from 'path';
import { Readable } from 'stream';
import { AuditService, type AuditActor } from '../common/audit.service';
import { PrismaService } from '../common/prisma.service';
import { StorageService } from '../common/storage.service';
import { optionRows, questionData, questionInclude, snapshot } from './questions.service';

const MAX_ROWS = 5000;

export interface RowError {
  row: number;
  refId?: string;
  messages: string[];
}

interface ParsedRow {
  row: number;
  input: QuestionInput;
  /** Existing question id when ref_id matches, so the import updates it. */
  updateId?: string;
  newTopic?: { subjectId: string; slug: string; nameEn: string };
}

type Cell = ExcelJS.CellValue;

function cellText(v: Cell): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('').trim();
    if ('text' in v) return String(v.text).trim();
    if ('result' in v) return cellText(v.result as Cell);
  }
  return String(v).trim();
}

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  // ------------------------------------------------------------- Template

  async template(format: 'xlsx' | 'csv'): Promise<Buffer> {
    const [exams, subjects] = await Promise.all([
      this.prisma.exam.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.subject.findMany({ orderBy: { nameEn: 'asc' }, include: { topics: true } }),
    ]);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Testwise';
    const sheet = wb.addWorksheet('Questions', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = QUESTION_IMPORT_COLUMNS.map((c) => ({ header: c, key: c, width: c.startsWith('question') || c.startsWith('solution') ? 40 : 16 }));
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF59E0B' } };

    const exam = exams[0]?.slug ?? 'ssc-cgl';
    const subject = subjects[0]?.slug ?? 'quantitative-aptitude';
    const topic = subjects[0]?.topics[0]?.slug ?? 'percentages';
    sheet.addRow({
      ref_id: 'SAMPLE-001', exam, class: '', subject, topic, difficulty: 'MEDIUM', type: 'MCQ_SINGLE',
      question_en: 'What is 20% of 150?', question_hi: '150 का 20% कितना है?',
      option_a_en: '20', option_a_hi: '20', option_b_en: '30', option_b_hi: '30',
      option_c_en: '35', option_c_hi: '35', option_d_en: '40', option_d_hi: '40',
      correct: 'B', marks: 2, negative_marks: 0.5,
      solution_en: '20/100 × 150 = 30', solution_hi: '20/100 × 150 = 30', tags: 'percentages,basics', source: 'In-house',
    });
    sheet.addRow({
      ref_id: 'SAMPLE-002', exam, class: '', subject, topic, difficulty: 'HARD', type: 'NUMERIC',
      question_en: 'Solve for $x$: $2x + 6 = 20$', question_hi: '$x$ का मान ज्ञात करें: $2x + 6 = 20$',
      correct: '7', numeric_tolerance: '0', marks: 2, negative_marks: 0, source: 'In-house',
    });

    if (format === 'csv') {
      const buf = await wb.csv.writeBuffer({ sheetName: 'Questions' } as never);
      // UTF-8 BOM so Excel opens Hindi text correctly.
      return Buffer.concat([Buffer.from('﻿', 'utf8'), Buffer.from(buf as ArrayBuffer)]);
    }

    const lists = wb.addWorksheet('Lists');
    lists.columns = [
      { header: 'exam', key: 'exam', width: 20 },
      { header: 'subject', key: 'subject', width: 26 },
      { header: 'difficulty', key: 'difficulty', width: 12 },
      { header: 'type', key: 'type', width: 14 },
      { header: 'subject → topic', key: 'topic', width: 40 },
    ];
    const topics = subjects.flatMap((s) => s.topics.map((t) => `${s.slug} → ${t.slug}`));
    const len = Math.max(exams.length, subjects.length, 3, topics.length);
    for (let i = 0; i < len; i++) {
      lists.addRow({
        exam: exams[i]?.slug, subject: subjects[i]?.slug,
        difficulty: ['EASY', 'MEDIUM', 'HARD'][i], type: ['MCQ_SINGLE', 'MCQ_MULTI', 'NUMERIC'][i], topic: topics[i],
      });
    }
    lists.getRow(1).font = { bold: true };
    const colOf = (name: string) => sheet.getColumn(name).letter;
    const listRule = (col: string, ref: string, allowBlank: boolean) =>
      (sheet as unknown as { dataValidations: { add(range: string, v: object): void } }).dataValidations.add(`${colOf(col)}2:${colOf(col)}${MAX_ROWS + 1}`, {
        type: 'list', allowBlank, formulae: [ref], showErrorMessage: true, errorTitle: 'Invalid value', error: `Pick a value from the list (sheet "Lists")`,
      });
    if (exams.length) listRule('exam', `Lists!$A$2:$A$${exams.length + 1}`, true);
    if (subjects.length) listRule('subject', `Lists!$B$2:$B$${subjects.length + 1}`, false);
    listRule('difficulty', 'Lists!$C$2:$C$4', false);
    listRule('type', 'Lists!$D$2:$D$4', false);

    const help = wb.addWorksheet('Instructions');
    help.getColumn(1).width = 22;
    help.getColumn(2).width = 100;
    const rows: [string, string][] = [
      ['How to use', 'Fill one question per row in the "Questions" sheet. Delete the two SAMPLE rows before uploading. Do not rename or reorder header columns.'],
      ['ref_id', 'Your own unique ID (e.g. SSC-QA-0001). Uploading the same ref_id again updates that question instead of creating a duplicate. Optional but strongly recommended.'],
      ['exam', 'Exam slug from the Lists sheet. Optional for school (class-wise) questions.'],
      ['class', 'Class 1–12 for school questions. Leave blank for competitive exams.'],
      ['subject', 'Required. Subject slug from the Lists sheet. Subjects must be created in the admin panel first.'],
      ['topic', 'Optional topic slug or name. A topic that does not exist yet is created automatically under the subject.'],
      ['difficulty', 'EASY, MEDIUM or HARD.'],
      ['type', 'MCQ_SINGLE (one correct option), MCQ_MULTI (one or more correct options) or NUMERIC (number answer, no options).'],
      ['question_en / _hi', 'Question text in English (required) and Hindi (optional). Use $...$ for maths, e.g. $x^2 + 1$.'],
      ['option_a_en … option_f_hi', '2 to 6 options for MCQ types, filled in order from A. Leave blank for NUMERIC.'],
      ['correct', 'MCQ_SINGLE: one letter, e.g. B. MCQ_MULTI: letters separated by commas, e.g. A,C. NUMERIC: the number, e.g. 7.5.'],
      ['numeric_tolerance', 'NUMERIC only. Accepted ± difference, e.g. 0.01. Blank means exact.'],
      ['marks / negative_marks', 'Marks for a correct answer and marks deducted for a wrong one. Defaults: 1 and 0.'],
      ['solution_en / _hi', 'Optional explanation shown after the test.'],
      ['question_image / solution_image', 'Optional image file name (e.g. q12.png). Upload a .zip containing these images together with this sheet.'],
      ['tags', 'Optional, comma separated.'],
      ['source / licence', 'Where the question came from and its licence or copyright owner.'],
      ['After upload', 'You will see a preview with errors per row. Fix and re-upload, or import only the valid rows. Imported questions start as Draft and need review before use.'],
    ];
    help.addRow(['Field', 'Description']).font = { bold: true };
    rows.forEach((r) => (help.addRow(r).alignment = { wrapText: true, vertical: 'top' }));

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ------------------------------------------------------------- Parse & validate

  private async readRows(fileName: string, data: Buffer): Promise<Record<string, string>[]> {
    const wb = new ExcelJS.Workbook();
    const ext = extname(fileName).toLowerCase();
    let sheet: ExcelJS.Worksheet | undefined;
    if (ext === '.xlsx') {
      await wb.xlsx.load(data as unknown as ArrayBuffer);
      sheet = wb.getWorksheet('Questions') ?? wb.worksheets[0];
    } else if (ext === '.csv') {
      const text = data.toString('utf8').replace(/^﻿/, '');
      sheet = await wb.csv.read(Readable.from([text]));
    } else {
      throw new BadRequestException('Upload a .xlsx or .csv file');
    }
    if (!sheet) throw new BadRequestException('No worksheet found');

    const header: string[] = [];
    sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
      header[col] = cellText(cell.value).toLowerCase().replace(/^﻿/, '');
    });
    const missing = ['subject', 'difficulty', 'type', 'question_en', 'correct'].filter((c) => !header.includes(c));
    if (missing.length) throw new BadRequestException(`Missing required columns: ${missing.join(', ')}. Download the latest template.`);

    const out: Record<string, string>[] = [];
    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const rec: Record<string, string> = { __row: String(r) };
      let any = false;
      header.forEach((h, col) => {
        if (!h) return;
        const v = cellText(row.getCell(col).value);
        if (v) any = true;
        rec[h] = v;
      });
      if (any) out.push(rec);
    }
    if (out.length > MAX_ROWS) throw new BadRequestException(`Maximum ${MAX_ROWS} rows per upload`);
    return out;
  }

  async validate(file: { originalname: string; buffer: Buffer }, images: { originalname: string; buffer: Buffer } | undefined, actor: AuditActor) {
    const records = await this.readRows(file.originalname, file.buffer);
    if (!records.length) throw new BadRequestException('The sheet has no question rows');

    const imageFiles = new Map<string, Buffer>();
    if (images) {
      if (extname(images.originalname).toLowerCase() !== '.zip') throw new BadRequestException('Images must be a .zip file');
      const zip = new AdmZip(images.buffer);
      for (const entry of zip.getEntries()) {
        if (!entry.isDirectory) imageFiles.set(basename(entry.entryName).toLowerCase(), entry.getData());
      }
    }

    const [exams, subjects, topics] = await Promise.all([
      this.prisma.exam.findMany(),
      this.prisma.subject.findMany(),
      this.prisma.topic.findMany(),
    ]);
    const findBy = <T extends { slug: string; nameEn: string }>(list: T[], v: string) => {
      const k = v.toLowerCase();
      return list.find((x) => x.slug === k || x.nameEn.toLowerCase() === k);
    };

    const refIds = records.map((r) => r.ref_id).filter(Boolean);
    const existing = await this.prisma.question.findMany({ where: { refId: { in: refIds } }, select: { id: true, refId: true, status: true } });
    const existingByRef = new Map(existing.map((e) => [e.refId!, e]));

    const seenRefs = new Set<string>();
    const parsed: ParsedRow[] = [];
    const errors: RowError[] = [];
    const savedImages = new Map<string, string>();

    const imageUrl = async (name: string, msgs: string[]) => {
      if (!name) return null;
      const key = basename(name).toLowerCase();
      if (savedImages.has(key)) return savedImages.get(key)!;
      const data = imageFiles.get(key);
      if (!data) {
        msgs.push(`Image "${name}" not found in the uploaded zip`);
        return null;
      }
      try {
        const url = await this.storage.saveImage(key, data, 'questions');
        savedImages.set(key, url);
        return url;
      } catch (e) {
        msgs.push(e instanceof Error ? e.message : `Could not save ${name}`);
        return null;
      }
    };

    for (const rec of records) {
      const rowNo = Number(rec.__row);
      const msgs: string[] = [];
      const refId = rec.ref_id || undefined;

      if (refId) {
        if (seenRefs.has(refId)) msgs.push(`Duplicate ref_id ${refId} in this file`);
        seenRefs.add(refId);
      }

      const subject = rec.subject ? findBy(subjects, rec.subject) : undefined;
      if (!subject) msgs.push(rec.subject ? `Unknown subject "${rec.subject}"` : 'subject is required');
      const exam = rec.exam ? findBy(exams, rec.exam) : undefined;
      if (rec.exam && !exam) msgs.push(`Unknown exam "${rec.exam}"`);

      let topicId: string | null = null;
      let newTopic: ParsedRow['newTopic'];
      if (rec.topic && subject) {
        const t = findBy(topics.filter((x) => x.subjectId === subject.id), rec.topic);
        if (t) topicId = t.id;
        else newTopic = { subjectId: subject.id, slug: slugify(rec.topic), nameEn: rec.topic };
      }

      const type = rec.type?.toUpperCase();
      const correctRaw = (rec.correct ?? '').toUpperCase().replace(/\s/g, '');
      const options = OPTION_LABELS.map((l) => ({
        label: l,
        textEn: rec[`option_${l.toLowerCase()}_en`] ?? '',
        textHi: rec[`option_${l.toLowerCase()}_hi`] || null,
      })).filter((o) => o.textEn || o.textHi);
      for (const o of options) if (!o.textEn) msgs.push(`Option ${o.label} has Hindi text but no English text`);

      const num = (v: string | undefined, field: string) => {
        if (!v) return undefined;
        const n = Number(v);
        if (Number.isNaN(n)) msgs.push(`${field} must be a number`);
        return n;
      };
      const classLevel = num(rec.class, 'class');

      const candidate = {
        refId: refId ?? null,
        type,
        difficulty: rec.difficulty?.toUpperCase(),
        examId: exam?.id ?? null,
        subjectId: subject?.id ?? '',
        topicId,
        classLevel: classLevel ?? null,
        textEn: rec.question_en,
        textHi: rec.question_hi || null,
        solutionEn: rec.solution_en || null,
        solutionHi: rec.solution_hi || null,
        imageUrl: await imageUrl(rec.question_image, msgs),
        solutionImageUrl: await imageUrl(rec.solution_image, msgs),
        options: type === 'NUMERIC' ? [] : options,
        correctLabels: type === 'NUMERIC' ? [] : correctRaw.split(',').filter(Boolean),
        correctNumeric: type === 'NUMERIC' ? num(rec.correct, 'correct') ?? null : null,
        numericTolerance: num(rec.numeric_tolerance, 'numeric_tolerance') ?? null,
        marks: num(rec.marks, 'marks') ?? 1,
        negativeMarks: num(rec.negative_marks, 'negative_marks') ?? 0,
        tags: (rec.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean),
        source: rec.source || null,
        licence: rec.licence || null,
      };

      const result = questionSchema.safeParse(candidate);
      if (!result.success) {
        for (const issue of result.error.issues) {
          const field = issue.path.join('.') || 'row';
          if (field === 'subjectId' && !subject) continue;
          msgs.push(`${field}: ${issue.message}`);
        }
      }
      const prior = refId ? existingByRef.get(refId) : undefined;
      if (prior?.status === 'RETIRED') msgs.push(`ref_id ${refId} belongs to a retired question; reopen it first`);

      if (msgs.length || !result.success) {
        errors.push({ row: rowNo, refId, messages: [...new Set(msgs)] });
      } else {
        parsed.push({ row: rowNo, input: result.data, updateId: prior?.id, newTopic });
      }
    }

    const batch = await this.prisma.importBatch.create({
      data: {
        fileName: file.originalname,
        totalRows: records.length,
        validRows: parsed.length,
        errorRows: errors.length,
        rows: parsed as unknown as Prisma.InputJsonValue,
        errors: errors as unknown as Prisma.InputJsonValue,
        createdById: actor.id!,
      },
    });
    await this.audit.log(actor, {
      action: 'import.validate',
      entityType: 'ImportBatch',
      entityId: batch.id,
      meta: { fileName: file.originalname, total: records.length, valid: parsed.length, errors: errors.length },
    });

    return {
      id: batch.id,
      fileName: batch.fileName,
      status: batch.status,
      totalRows: batch.totalRows,
      validRows: batch.validRows,
      errorRows: batch.errorRows,
      creates: parsed.filter((p) => !p.updateId).length,
      updates: parsed.filter((p) => p.updateId).length,
      newTopics: [...new Set(parsed.filter((p) => p.newTopic).map((p) => p.newTopic!.nameEn))],
      errors,
      preview: parsed.slice(0, 20).map((p) => ({
        row: p.row,
        refId: p.input.refId,
        type: p.input.type,
        difficulty: p.input.difficulty,
        textEn: p.input.textEn,
        hasHindi: !!p.input.textHi,
        action: p.updateId ? 'update' : 'create',
      })),
    };
  }

  // ------------------------------------------------------------- Commit & rollback

  async commit(batchId: string, actor: AuditActor) {
    const batch = await this.prisma.importBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('Import not found');
    if (batch.status !== 'VALIDATED') throw new ConflictException(`Import is already ${batch.status.toLowerCase()}`);
    const rows = batch.rows as unknown as ParsedRow[];
    if (!rows.length) throw new BadRequestException('No valid rows to import');

    const summary = await this.prisma.$transaction(
      async (tx) => {
        const topicIds = new Map<string, string>();
        let created = 0;
        let updated = 0;
        const changes: { id: string; action: 'create' | 'update'; prevVersion?: number }[] = [];
        for (const r of rows) {
          const input = { ...r.input };
          if (r.newTopic) {
            const key = `${r.newTopic.subjectId}:${r.newTopic.slug}`;
            if (!topicIds.has(key)) {
              const t = await tx.topic.upsert({
                where: { subjectId_slug: { subjectId: r.newTopic.subjectId, slug: r.newTopic.slug } },
                create: r.newTopic,
                update: {},
              });
              topicIds.set(key, t.id);
            }
            input.topicId = topicIds.get(key)!;
          }
          if (r.updateId) {
            const before = await tx.question.findUnique({ where: { id: r.updateId }, include: questionInclude });
            if (!before) throw new ConflictException(`Question for row ${r.row} was deleted after validation; re-upload the file`);
            if (before.status === 'RETIRED') throw new ConflictException(`Row ${r.row}: question was retired after validation`);
            await tx.questionVersion.create({
              data: { questionId: before.id, version: before.version, snapshot: snapshot(before), changedById: actor.id },
            });
            await tx.questionOption.deleteMany({ where: { questionId: before.id } });
            await tx.question.update({
              where: { id: before.id },
              data: {
                ...questionData(input),
                status: 'DRAFT',
                version: before.version + 1,
                importBatchId: batch.id,
                options: { create: optionRows(input) },
              },
            });
            changes.push({ id: before.id, action: 'update', prevVersion: before.version });
            updated++;
          } else {
            if (input.refId && (await tx.question.findUnique({ where: { refId: input.refId } }))) {
              throw new ConflictException(`Row ${r.row}: ref_id ${input.refId} was created after validation; re-upload the file`);
            }
            const q = await tx.question.create({
              data: { ...questionData(input), createdById: actor.id, importBatchId: batch.id, options: { create: optionRows(input) } },
            });
            changes.push({ id: q.id, action: 'create' });
            created++;
          }
        }
        await tx.importBatch.update({
          where: { id: batch.id },
          data: { status: 'IMPORTED', importedAt: new Date(), rows: { rows, changes } as unknown as Prisma.InputJsonValue },
        });
        await this.audit.log(actor, { action: 'import.commit', entityType: 'ImportBatch', entityId: batch.id, meta: { created, updated } }, tx);
        return { created, updated };
      },
      { timeout: 120_000 },
    );
    return { id: batch.id, status: 'IMPORTED', ...summary };
  }

  /** Undo an import: delete created questions and restore updated ones, if nobody changed them since. */
  async rollback(batchId: string, actor: AuditActor) {
    const batch = await this.prisma.importBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('Import not found');
    if (batch.status !== 'IMPORTED') throw new ConflictException('Only completed imports can be rolled back');
    const { changes } = batch.rows as unknown as { changes: { id: string; action: 'create' | 'update'; prevVersion?: number }[] };

    await this.prisma.$transaction(
      async (tx) => {
        for (const c of changes) {
          const q = await tx.question.findUnique({ where: { id: c.id } });
          if (!q) continue;
          if (q.importBatchId !== batch.id || q.status !== 'DRAFT') {
            throw new ConflictException(`Question ${q.refId ?? q.id} was edited or reviewed after import; rollback blocked`);
          }
          if (c.action === 'create') {
            await tx.question.delete({ where: { id: c.id } });
          } else {
            const prev = await tx.questionVersion.findUnique({ where: { questionId_version: { questionId: c.id, version: c.prevVersion! } } });
            if (!prev) throw new ConflictException(`Missing version history for ${q.refId ?? q.id}`);
            const s = prev.snapshot as unknown as Record<string, unknown> & { options: { label: string; textEn: string; textHi: string | null; sortOrder: number }[] };
            await tx.questionOption.deleteMany({ where: { questionId: c.id } });
            await tx.question.update({
              where: { id: c.id },
              data: {
                refId: s.refId as string | null, type: s.type as never, difficulty: s.difficulty as never, status: s.status as never,
                examId: s.examId as string | null, subjectId: s.subjectId as string, topicId: s.topicId as string | null,
                classLevel: s.classLevel as number | null, textEn: s.textEn as string, textHi: s.textHi as string | null,
                solutionEn: s.solutionEn as string | null, solutionHi: s.solutionHi as string | null,
                imageUrl: s.imageUrl as string | null, solutionImageUrl: s.solutionImageUrl as string | null,
                correctLabels: s.correctLabels as string[], correctNumeric: s.correctNumeric as number | null,
                numericTolerance: s.numericTolerance as number | null, marks: s.marks as number, negativeMarks: s.negativeMarks as number,
                tags: s.tags as string[], source: s.source as string | null, licence: s.licence as string | null,
                importBatchId: s.importBatchId as string | null,
                version: q.version + 1,
                options: { create: s.options.map((o) => ({ label: o.label, textEn: o.textEn, textHi: o.textHi, sortOrder: o.sortOrder })) },
              },
            });
          }
        }
        await tx.importBatch.update({ where: { id: batch.id }, data: { status: 'ROLLED_BACK' } });
        await this.audit.log(actor, { action: 'import.rollback', entityType: 'ImportBatch', entityId: batch.id, meta: { questions: changes.length } }, tx);
      },
      { timeout: 120_000 },
    );
    return { id: batch.id, status: 'ROLLED_BACK' };
  }

  list() {
    return this.prisma.importBatch.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, fileName: true, status: true, totalRows: true, validRows: true, errorRows: true, createdById: true, importedAt: true, createdAt: true },
    });
  }

  async get(id: string) {
    const b = await this.prisma.importBatch.findUnique({ where: { id } });
    if (!b) throw new NotFoundException('Import not found');
    const { rows: _rows, ...rest } = b;
    return rest;
  }
}
