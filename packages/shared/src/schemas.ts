import { proctorOptionsSchema } from './proctoring';
import { z } from 'zod';

const isoDate = z.string().datetime({ offset: true });
const optionalText = z.string().trim().max(20000).optional().nullable();

// ---------- Student auth & onboarding ----------

/** UTF-8 byte length without Buffer/TextEncoder, so it also works in React Native. */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      bytes += 4; // surrogate pair = one 4-byte code point
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/** bcrypt only uses the first 72 bytes of a password; longer ones would silently collapse to the same hash, so refuse them. */
export const MAX_PASSWORD_BYTES = 72;
const newPassword = (min: number) =>
  z
    .string()
    .min(min)
    .max(128)
    .refine((v) => utf8ByteLength(v) <= MAX_PASSWORD_BYTES, { message: `Password must be at most ${MAX_PASSWORD_BYTES} bytes (about ${MAX_PASSWORD_BYTES} plain characters)` });

const emailField = z.string().trim().toLowerCase().max(254).email();

export const registerSchema = z.object({
  email: emailField,
  password: newPassword(8),
  displayName: z.string().trim().min(2).max(60),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(10) });

export const onboardingSchema = z
  .object({
    audience: z.enum(['SCHOOL', 'EXAM']),
    classLevel: z.number().int().min(6).max(12).optional().nullable(),
    board: z.string().trim().max(40).optional().nullable(),
    dateOfBirth: z.string().date().optional().nullable(),
    guardianConsent: z.boolean().optional(),
    examIds: z.array(z.string()).max(10).default([]),
    language: z.enum(['EN', 'HI']),
  })
  .refine((v) => v.audience !== 'SCHOOL' || v.classLevel != null, {
    message: 'classLevel is required for school students',
    path: ['classLevel'],
  });
export type OnboardingInput = z.infer<typeof onboardingSchema>;

export const preferencesSchema = z.object({
  language: z.enum(['EN', 'HI']).optional(),
  displayName: z.string().trim().min(2).max(60).optional(),
});

// ---------- Admin auth ----------

export const adminLoginSchema = loginSchema;

export const adminCreateSchema = z.object({
  email: emailField,
  name: z.string().trim().min(2).max(80),
  password: newPassword(10),
  role: z.enum(['SUPER_ADMIN', 'OPERATIONS', 'CONTENT', 'FINANCE', 'FRAUD', 'SUPPORT']),
});

// ---------- Taxonomy ----------

export const examSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/).max(40),
  nameEn: z.string().trim().min(1).max(80),
  nameHi: z.string().trim().max(80).optional().nullable(),
  category: z.enum(['SCHOOL', 'COMPETITIVE']),
  icon: z.string().trim().max(40).default('book'),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#F59E0B'),
  sortOrder: z.number().int().default(0),
  active: z.boolean().default(true),
});

export const subjectSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/).max(40),
  nameEn: z.string().trim().min(1).max(80),
  nameHi: z.string().trim().max(80).optional().nullable(),
});

export const topicSchema = subjectSchema.extend({ subjectId: z.string() });

// ---------- Questions ----------

export const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

export const questionOptionSchema = z.object({
  label: z.enum(OPTION_LABELS),
  textEn: z.string().trim().min(1).max(5000),
  textHi: optionalText,
});

export const questionSchema = z
  .object({
    refId: z.string().trim().max(80).optional().nullable(),
    type: z.enum(['MCQ_SINGLE', 'MCQ_MULTI', 'NUMERIC']),
    difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
    examId: z.string().optional().nullable(),
    subjectId: z.string(),
    topicId: z.string().optional().nullable(),
    classLevel: z.number().int().min(1).max(12).optional().nullable(),
    textEn: z.string().trim().min(1).max(20000),
    textHi: optionalText,
    solutionEn: optionalText,
    solutionHi: optionalText,
    imageUrl: z.string().max(500).optional().nullable(),
    solutionImageUrl: z.string().max(500).optional().nullable(),
    options: z.array(questionOptionSchema).max(6).default([]),
    correctLabels: z.array(z.enum(OPTION_LABELS)).default([]),
    correctNumeric: z.number().optional().nullable(),
    numericTolerance: z.number().min(0).optional().nullable(),
    marks: z.number().min(0).max(100).default(1),
    negativeMarks: z.number().min(0).max(100).default(0),
    tags: z.array(z.string().trim().max(40)).max(20).default([]),
    source: z.string().trim().max(200).optional().nullable(),
    licence: z.string().trim().max(200).optional().nullable(),
  })
  .superRefine((q, ctx) => validateQuestionAnswer(q, ctx));
export type QuestionInput = z.infer<typeof questionSchema>;

type AnswerFields = {
  type: 'MCQ_SINGLE' | 'MCQ_MULTI' | 'NUMERIC';
  options: { label: string }[];
  correctLabels: string[];
  correctNumeric?: number | null;
};

export function validateQuestionAnswer(q: AnswerFields, ctx: z.RefinementCtx) {
  if (q.type === 'NUMERIC') {
    if (q.correctNumeric == null || Number.isNaN(q.correctNumeric)) {
      ctx.addIssue({ code: 'custom', path: ['correctNumeric'], message: 'Numeric answer is required' });
    }
    return;
  }
  if (q.options.length < 2) {
    ctx.addIssue({ code: 'custom', path: ['options'], message: 'At least 2 options are required' });
  }
  const labels = q.options.map((o) => o.label);
  if (new Set(labels).size !== labels.length) {
    ctx.addIssue({ code: 'custom', path: ['options'], message: 'Option labels must be unique' });
  }
  if (q.correctLabels.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['correctLabels'], message: 'Select the correct option' });
  }
  if (q.type === 'MCQ_SINGLE' && q.correctLabels.length > 1) {
    ctx.addIssue({ code: 'custom', path: ['correctLabels'], message: 'Single-answer question has one correct option' });
  }
  for (const l of q.correctLabels) {
    if (!labels.includes(l)) {
      ctx.addIssue({ code: 'custom', path: ['correctLabels'], message: `Correct option ${l} does not exist` });
    }
  }
}

export const questionReviewSchema = z.object({
  action: z.enum(['SUBMIT', 'APPROVE', 'REJECT', 'RETIRE', 'REOPEN']),
  note: z.string().trim().max(1000).optional(),
});

/** Columns of the bulk-upload template, in order. */
export const QUESTION_IMPORT_COLUMNS = [
  'ref_id',
  'exam',
  'class',
  'subject',
  'topic',
  'difficulty',
  'type',
  'question_en',
  'question_hi',
  ...OPTION_LABELS.flatMap((l) => [`option_${l.toLowerCase()}_en`, `option_${l.toLowerCase()}_hi`]),
  'correct',
  'numeric_tolerance',
  'marks',
  'negative_marks',
  'solution_en',
  'solution_hi',
  'question_image',
  'solution_image',
  'tags',
  'source',
  'licence',
] as const;

// ---------- Tournaments ----------

export const prizeTierSchema = z.object({
  fromRank: z.number().int().min(1),
  toRank: z.number().int().min(1),
  amountPaise: z.number().int().min(0).default(0),
  rewardEn: z.string().trim().max(200).optional().nullable(),
  rewardHi: z.string().trim().max(200).optional().nullable(),
});
export type PrizeTier = z.infer<typeof prizeTierSchema>;

export const eligibilitySchema = z.object({
  audience: z.array(z.enum(['SCHOOL', 'EXAM'])).default([]),
  classLevels: z.array(z.number().int().min(1).max(12)).default([]),
  minAge: z.number().int().min(0).max(100).optional().nullable(),
  maxAge: z.number().int().min(0).max(100).optional().nullable(),
  /** Only students who picked one of these exams (e.g. SSC CGL aspirants). Empty = any exam. */
  examIds: z.array(z.string()).default([]),
  requiresVerifiedEmail: z.boolean().default(false),
});
export type Eligibility = z.infer<typeof eligibilitySchema>;

export const tournamentSchema = z
  .object({
    slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/).max(80),
    titleEn: z.string().trim().min(3).max(120),
    titleHi: z.string().trim().max(120).optional().nullable(),
    descriptionEn: optionalText,
    descriptionHi: optionalText,
    rulesEn: optionalText,
    rulesHi: optionalText,
    scoringEn: optionalText,
    scoringHi: optionalText,
    refundPolicyEn: optionalText,
    refundPolicyHi: optionalText,
    examId: z.string().optional().nullable(),
    subjectId: z.string().optional().nullable(),
    testId: z.string().optional().nullable(),
    format: z.enum(['MASS', 'KNOCKOUT', 'LEAGUE', 'DUEL']),
    entryMode: z.enum(['FREE', 'PAID']),
    entryFeePaise: z.number().int().min(0).default(0),
    platformFeePercent: z.number().min(0).max(100).default(0),
    rewardType: z.enum(['NONE', 'CASH', 'VOUCHER', 'SCHOLARSHIP', 'MERCHANDISE', 'MIXED']),
    fundingSource: z.enum(['PLATFORM', 'SPONSOR', 'ENTRY_FEES']),
    sponsorName: z.string().trim().max(120).optional().nullable(),
    prizeTiers: z.array(prizeTierSchema).max(50).default([]),
    maxParticipants: z.number().int().min(2).max(1_000_000),
    minParticipants: z.number().int().min(1).default(1),
    registrationOpensAt: isoDate,
    registrationClosesAt: isoDate,
    startsAt: isoDate,
    endsAt: isoDate,
    durationMinutes: z.number().int().min(1).max(600),
    questionCount: z.number().int().min(1).max(500),
    eligibility: eligibilitySchema.default({}),
    bannerColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#1E3A8A'),
    bannerImageUrl: z.string().max(500).optional().nullable(),
    featured: z.boolean().default(false),
    proctorMode: z.enum(['OFF', 'BASIC', 'AI', 'LIVE']).default('OFF'),
    proctorOptions: proctorOptionsSchema,
  })
  .superRefine((t, ctx) => {
    const order: [keyof typeof t, keyof typeof t][] = [
      ['registrationOpensAt', 'registrationClosesAt'],
      ['registrationClosesAt', 'startsAt'],
      ['startsAt', 'endsAt'],
    ];
    for (const [a, b] of order) {
      if (new Date(t[a] as string) > new Date(t[b] as string)) {
        ctx.addIssue({ code: 'custom', path: [b], message: `${String(b)} must be after ${String(a)}` });
      }
    }
    if (t.entryMode === 'FREE' && t.entryFeePaise !== 0) {
      ctx.addIssue({ code: 'custom', path: ['entryFeePaise'], message: 'Free tournaments have no entry fee' });
    }
    if (t.entryMode === 'PAID' && t.entryFeePaise <= 0) {
      ctx.addIssue({ code: 'custom', path: ['entryFeePaise'], message: 'Paid tournaments need an entry fee' });
    }
    if (t.minParticipants > t.maxParticipants) {
      ctx.addIssue({ code: 'custom', path: ['minParticipants'], message: 'Minimum exceeds capacity' });
    }
    const sorted = [...t.prizeTiers].sort((a, b) => a.fromRank - b.fromRank);
    let prev = 0;
    for (const tier of sorted) {
      if (tier.toRank < tier.fromRank) {
        ctx.addIssue({ code: 'custom', path: ['prizeTiers'], message: `Rank range ${tier.fromRank}-${tier.toRank} is invalid` });
      }
      if (tier.fromRank <= prev) {
        ctx.addIssue({ code: 'custom', path: ['prizeTiers'], message: 'Prize rank ranges overlap' });
      }
      prev = tier.toRank;
    }
  });
export type TournamentInput = z.infer<typeof tournamentSchema>;

export const tournamentTransitionSchema = z.object({
  to: z.enum([
    'DRAFT',
    'SCHEDULED',
    'REG_OPEN',
    'REG_CLOSED',
    'LIVE',
    'IN_REVIEW',
    'FINAL',
    'REWARDS_APPROVED',
    'CLOSED',
    'CANCELLED',
  ]),
  reason: z.string().trim().max(1000).optional(),
});

export const ruleChangeSchema = z.object({
  summaryEn: z.string().trim().min(3).max(1000),
  summaryHi: z.string().trim().max(1000).optional().nullable(),
});

// ---------- CMS ----------

export const bannerSchema = z.object({
  tagEn: z.string().trim().max(40).optional().nullable(),
  tagHi: z.string().trim().max(40).optional().nullable(),
  titleEn: z.string().trim().min(1).max(80),
  titleHi: z.string().trim().max(80).optional().nullable(),
  subtitleEn: z.string().trim().max(160).optional().nullable(),
  subtitleHi: z.string().trim().max(160).optional().nullable(),
  ctaEn: z.string().trim().max(30).optional().nullable(),
  ctaHi: z.string().trim().max(30).optional().nullable(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#F59E0B'),
  imageUrl: z.string().max(500).optional().nullable(),
  linkType: z.enum(['NONE', 'TOURNAMENT', 'EXAM', 'SERIES', 'URL']).default('NONE'),
  linkTarget: z.string().trim().max(500).optional().nullable(),
  sortOrder: z.number().int().default(0),
  active: z.boolean().default(true),
  startsAt: isoDate.optional().nullable(),
  endsAt: isoDate.optional().nullable(),
});
export type BannerInput = z.infer<typeof bannerSchema>;

export const homeSectionUpdateSchema = z.object({
  sections: z
    .array(
      z.object({
        key: z.enum(['LIVE_TOURNAMENTS', 'CONTINUE_LEARNING', 'DAILY_MISSIONS', 'POPULAR_EXAMS', 'LEADERBOARD']),
        titleEn: z.string().trim().min(1).max(60),
        titleHi: z.string().trim().max(60).optional().nullable(),
        enabled: z.boolean(),
        sortOrder: z.number().int(),
      }),
    )
    .min(1),
});

export const userStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  reason: z.string().trim().min(3).max(1000),
});
