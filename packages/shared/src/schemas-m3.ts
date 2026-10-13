import { proctorOptionsSchema } from './proctoring';
import { z } from 'zod';

const optionalText = z.string().trim().max(20000).optional().nullable();
const isoDate = z.string().datetime({ offset: true });

// ---------- Tests ----------

export const testSchema = z.object({
  titleEn: z.string().trim().min(2).max(160),
  titleHi: z.string().trim().max(160).optional().nullable(),
  instructionsEn: optionalText,
  instructionsHi: optionalText,
  examId: z.string().optional().nullable(),
  kind: z.enum(['MOCK', 'SECTIONAL', 'PRACTICE', 'PREVIOUS_YEAR', 'TOURNAMENT']),
  durationMinutes: z.number().int().min(1).max(600),
  shuffleQuestions: z.boolean().default(false),
  shuffleOptions: z.boolean().default(false),
  allowLanguageSwitch: z.boolean().default(true),
  answerKeyPolicy: z.enum(['ON_SUBMIT', 'AFTER_WINDOW', 'AFTER_FINAL', 'NEVER']),
  maxAttempts: z.number().int().min(1).max(50).default(1),
  proctorMode: z.enum(['OFF', 'BASIC', 'AI', 'LIVE']).default('OFF'),
  proctorOptions: proctorOptionsSchema,
  sections: z
    .array(
      z.object({
        id: z.string().optional(),
        titleEn: z.string().trim().min(1).max(80),
        titleHi: z.string().trim().max(80).optional().nullable(),
        questions: z
          .array(
            z.object({
              questionId: z.string(),
              marks: z.number().min(0).max(100).optional().nullable(),
              negativeMarks: z.number().min(0).max(100).optional().nullable(),
            }),
          )
          .max(500),
      }),
    )
    .min(1)
    .max(20),
});
export type TestInput = z.infer<typeof testSchema>;

export const assembleSchema = z.object({
  examId: z.string().optional().nullable(),
  subjectId: z.string().optional().nullable(),
  topicId: z.string().optional().nullable(),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional().nullable(),
  count: z.number().int().min(1).max(200),
  excludeIds: z.array(z.string()).default([]),
});

// ---------- Attempts ----------

export const answerSchema = z.object({
  questionId: z.string(),
  selectedLabels: z.array(z.string().max(1)).max(6).default([]),
  numericValue: z.number().optional().nullable(),
  markedForReview: z.boolean().default(false),
  timeSpentSec: z.number().int().min(0).max(36000).default(0),
});

export const saveAnswersSchema = z.object({
  answers: z.array(answerSchema).max(500),
  language: z.enum(['EN', 'HI']).optional(),
});
export type SaveAnswersInput = z.infer<typeof saveAnswersSchema>;

export const attemptEventSchema = z.object({
  type: z.enum([
    'SESSION_STARTED', 'APP_BACKGROUND', 'APP_FOREGROUND', 'OFFLINE', 'ONLINE', 'LANGUAGE_SWITCH',
    'CAMERA_PERMISSION', 'MIC_PERMISSION', 'SCREEN_CAPTURE_STATE', 'SCREENSHOT_TAKEN', 'CAMERA_SIGNAL', 'MIC_SIGNAL', 'DEVICE_CHECK',
  ]),
  /** Random per app session; never a hardware identifier. */
  clientSessionId: z.string().trim().min(8).max(80).optional(),
  eventId: z.string().uuid().optional(),
  sequence: z.number().int().min(0).max(10_000_000).optional(),
  clientAt: isoDate.optional(),
  platform: z.enum(['android', 'ios', 'web']).optional(),
  appVersion: z.string().trim().max(40).optional().nullable(),
  osVersion: z.string().trim().max(80).optional().nullable(),
  deviceModel: z.string().trim().max(100).optional().nullable(),
  meta: z.object({
    to: z.enum(['EN', 'HI']).optional(),
    enabled: z.boolean().optional(),
    signal: z.enum(['FACE_MISSING', 'MULTIPLE_FACES', 'CAMERA_BLOCKED', 'VOICE_DETECTED', 'ANSWER_SPOKEN', 'BACKGROUND_NOISE']).optional(),
    confidence: z.number().finite().min(0).max(1).optional(),
  }).strict().optional(),
}).superRefine((event, ctx) => {
  if (event.sequence !== undefined && !event.clientSessionId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['clientSessionId'], message: 'A client session id is required with a sequence number' });
  }
  if (event.type === 'CAMERA_PERMISSION' || event.type === 'MIC_PERMISSION' || event.type === 'SCREEN_CAPTURE_STATE') {
    if (typeof event.meta?.enabled !== 'boolean') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['meta', 'enabled'], message: 'This event requires an enabled boolean' });
    }
  }
  if (event.type === 'CAMERA_SIGNAL' || event.type === 'MIC_SIGNAL') {
    const cameraSignal = ['FACE_MISSING', 'MULTIPLE_FACES', 'CAMERA_BLOCKED'].includes(event.meta?.signal ?? '');
    const micSignal = ['VOICE_DETECTED', 'ANSWER_SPOKEN', 'BACKGROUND_NOISE'].includes(event.meta?.signal ?? '');
    if (!(event.type === 'CAMERA_SIGNAL' ? cameraSignal : micSignal) || typeof event.meta?.confidence !== 'number') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['meta'], message: 'Signal events require a signal name and confidence from 0 to 1' });
    }
  }
});

// ---------- Store ----------

export const seriesSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/).max(80),
  titleEn: z.string().trim().min(2).max(160),
  titleHi: z.string().trim().max(160).optional().nullable(),
  descriptionEn: optionalText,
  descriptionHi: optionalText,
  examId: z.string().optional().nullable(),
  pricePaise: z.number().int().min(0),
  mrpPaise: z.number().int().min(0).optional().nullable(),
  validityDays: z.number().int().min(1).max(3650),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  imageUrl: z.string().max(500).optional().nullable(),
  badgeEn: z.string().trim().max(30).optional().nullable(),
  badgeHi: z.string().trim().max(30).optional().nullable(),
  features: z.array(z.object({ en: z.string().trim().min(1).max(120), hi: z.string().trim().max(120).optional().nullable() })).max(12),
  featured: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  tests: z.array(z.object({ testId: z.string(), freePreview: z.boolean().default(false) })).max(500),
});
export type SeriesInput = z.infer<typeof seriesSchema>;

export const couponSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/),
    descriptionEn: z.string().trim().max(200).optional().nullable(),
    percentOff: z.number().int().min(1).max(100).optional().nullable(),
    amountOffPaise: z.number().int().min(1).optional().nullable(),
    maxUses: z.number().int().min(1).optional().nullable(),
    appliesTo: z.enum(['ALL', 'SERIES', 'TOURNAMENT']),
    startsAt: isoDate.optional().nullable(),
    endsAt: isoDate.optional().nullable(),
    active: z.boolean().default(true),
  })
  .refine((c) => !!c.percentOff !== !!c.amountOffPaise, { message: 'Set either a percentage or a fixed amount', path: ['percentOff'] });

export const checkoutSchema = z.object({
  couponCode: z.string().trim().toUpperCase().max(30).optional().nullable(),
  idempotencyKey: z.string().min(8).max(80),
});

export const refundRequestSchema = z.object({
  amountPaise: z.number().int().min(1).optional(),
  reason: z.string().trim().min(3).max(500),
});

// ---------- Results ----------

export const resultActionSchema = z.object({
  userId: z.string(),
  action: z.enum(['DISQUALIFY', 'REINSTATE', 'ADJUST']),
  amount: z.number().min(-1000).max(1000).optional(),
  reason: z.string().trim().min(3).max(500),
});

export const rewardActionSchema = z.object({
  userIds: z.array(z.string()).min(1).max(1000),
  /** PAY_COINS credits the prize to the wallet as earned coins (needs wallet.tournamentPrizesAsCoins). */
  action: z.enum(['APPROVE', 'MARK_PAID', 'WITHHOLD', 'PAY_COINS']),
  payoutRef: z.string().trim().max(120).optional(),
  reason: z.string().trim().max(500).optional(),
});

// ---------- Engagement & support ----------

export const faqSchema = z.object({
  category: z.string().trim().min(1).max(40),
  questionEn: z.string().trim().min(3).max(300),
  questionHi: z.string().trim().max(300).optional().nullable(),
  answerEn: z.string().trim().min(3).max(5000),
  answerHi: z.string().trim().max(5000).optional().nullable(),
  sortOrder: z.number().int().default(0),
  active: z.boolean().default(true),
});

export const notificationSchema = z.object({
  audience: z.enum(['ALL', 'TOURNAMENT', 'USER']),
  tournamentId: z.string().optional().nullable(),
  userId: z.string().optional().nullable(),
  titleEn: z.string().trim().min(2).max(120),
  titleHi: z.string().trim().max(120).optional().nullable(),
  bodyEn: z.string().trim().min(2).max(1000),
  bodyHi: z.string().trim().max(1000).optional().nullable(),
  link: z.string().trim().max(300).optional().nullable(),
});

export const ticketCreateSchema = z.object({
  category: z.enum(['GENERAL', 'PAYMENT', 'RESULT_APPEAL', 'TECHNICAL', 'ACCOUNT', 'DATA_DELETION']),
  subject: z.string().trim().min(3).max(140),
  message: z.string().trim().min(3).max(4000),
  tournamentId: z.string().optional().nullable(),
  orderId: z.string().optional().nullable(),
});

export const ticketReplySchema = z.object({
  body: z.string().trim().min(1).max(4000),
  close: z.boolean().optional(),
});

// ---------- Push & notifications ----------

export const deviceSchema = z.object({
  token: z.string().min(10).max(4096),
  provider: z.enum(['FCM', 'APNS']),
  platform: z.enum(['android', 'ios']),
  appVersion: z.string().max(40).optional().nullable(),
  locale: z.string().max(20).optional().nullable(),
});

export const notificationPrefsSchema = z.object({
  categories: z.record(z.string(), z.boolean()),
});

export const campaignSchema = z
  .object({
    audience: z.enum(['ALL', 'USERS', 'TOURNAMENT', 'EXAM', 'SEGMENT']),
    userRefs: z.array(z.string().trim().min(1).max(200)).max(50000).default([]),
    tournamentId: z.string().optional().nullable(),
    examId: z.string().optional().nullable(),
    segment: z
      .object({
        audience: z.enum(['SCHOOL', 'EXAM']).optional().nullable(),
        classLevels: z.array(z.number().int().min(1).max(12)).default([]),
        inactiveDays: z.number().int().min(0).max(365).optional().nullable(),
      })
      .optional()
      .nullable(),
    category: z.enum(['TOURNAMENTS', 'DUELS', 'RESULTS', 'PAYMENTS', 'LEARNING', 'ACCOUNT', 'SUPPORT', 'PROMOTIONS']),
    titleEn: z.string().trim().min(2).max(120),
    titleHi: z.string().trim().max(120).optional().nullable(),
    bodyEn: z.string().trim().min(2).max(1000),
    bodyHi: z.string().trim().max(1000).optional().nullable(),
    link: z.string().trim().max(300).optional().nullable(),
    push: z.boolean().default(true),
    inbox: z.boolean().default(true),
    sendAt: z.string().datetime({ offset: true }).optional().nullable(),
  })
  .refine((c) => c.push || c.inbox, { message: 'Choose push, inbox or both', path: ['push'] })
  .refine((c) => c.audience !== 'USERS' || c.userRefs.length > 0, { message: 'Add at least one student', path: ['userRefs'] })
  .refine((c) => c.audience !== 'TOURNAMENT' || !!c.tournamentId, { message: 'Choose a tournament', path: ['tournamentId'] })
  .refine((c) => c.audience !== 'EXAM' || !!c.examId, { message: 'Choose an exam', path: ['examId'] });
export type CampaignInput = z.infer<typeof campaignSchema>;

export const templateUpdateSchema = z.object({
  titleEn: z.string().trim().min(1).max(160),
  titleHi: z.string().trim().max(160),
  bodyEn: z.string().trim().min(1).max(1000),
  bodyHi: z.string().trim().max(1000),
  push: z.boolean(),
  inbox: z.boolean(),
  enabled: z.boolean(),
});

// ---------- Duels ----------

export const botPersonaSchema = z.object({
  name: z.string().trim().min(2).max(40),
  city: z.string().trim().max(40).optional().nullable(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#8B5CF6'),
  ratingMin: z.number().int().min(100).max(3000),
  ratingMax: z.number().int().min(100).max(3000),
  active: z.boolean().default(true),
}).refine((b) => b.ratingMax >= b.ratingMin, { message: 'Max rating must be at least min rating', path: ['ratingMax'] });
