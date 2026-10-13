// String enums shared by api, admin and mobile. Values must match the Prisma enums.

export const Language = { EN: 'EN', HI: 'HI' } as const;
export type Language = (typeof Language)[keyof typeof Language];

export const Audience = { SCHOOL: 'SCHOOL', EXAM: 'EXAM' } as const;
export type Audience = (typeof Audience)[keyof typeof Audience];

export const ExamCategory = { SCHOOL: 'SCHOOL', COMPETITIVE: 'COMPETITIVE' } as const;
export type ExamCategory = (typeof ExamCategory)[keyof typeof ExamCategory];

export const AdminRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  OPERATIONS: 'OPERATIONS',
  CONTENT: 'CONTENT',
  FINANCE: 'FINANCE',
  FRAUD: 'FRAUD',
  SUPPORT: 'SUPPORT',
} as const;
export type AdminRole = (typeof AdminRole)[keyof typeof AdminRole];

export const QuestionType = {
  MCQ_SINGLE: 'MCQ_SINGLE',
  MCQ_MULTI: 'MCQ_MULTI',
  NUMERIC: 'NUMERIC',
} as const;
export type QuestionType = (typeof QuestionType)[keyof typeof QuestionType];

export const Difficulty = { EASY: 'EASY', MEDIUM: 'MEDIUM', HARD: 'HARD' } as const;
export type Difficulty = (typeof Difficulty)[keyof typeof Difficulty];

export const QuestionStatus = {
  DRAFT: 'DRAFT',
  IN_REVIEW: 'IN_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  RETIRED: 'RETIRED',
} as const;
export type QuestionStatus = (typeof QuestionStatus)[keyof typeof QuestionStatus];

export const TournamentStatus = {
  DRAFT: 'DRAFT',
  SCHEDULED: 'SCHEDULED',
  REG_OPEN: 'REG_OPEN',
  REG_CLOSED: 'REG_CLOSED',
  LIVE: 'LIVE',
  IN_REVIEW: 'IN_REVIEW',
  FINAL: 'FINAL',
  REWARDS_APPROVED: 'REWARDS_APPROVED',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
} as const;
export type TournamentStatus = (typeof TournamentStatus)[keyof typeof TournamentStatus];

/** Allowed lifecycle transitions. Anything not listed is rejected by the API. */
export const TOURNAMENT_TRANSITIONS: Record<TournamentStatus, TournamentStatus[]> = {
  DRAFT: ['SCHEDULED', 'CANCELLED'],
  SCHEDULED: ['REG_OPEN', 'DRAFT', 'CANCELLED'],
  REG_OPEN: ['REG_CLOSED', 'CANCELLED'],
  REG_CLOSED: ['LIVE', 'REG_OPEN', 'CANCELLED'],
  LIVE: ['IN_REVIEW'],
  IN_REVIEW: ['FINAL'],
  FINAL: ['REWARDS_APPROVED', 'CLOSED'],
  REWARDS_APPROVED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

/** Statuses visible to students. DRAFT is admin-only. */
export const PUBLIC_TOURNAMENT_STATUSES: TournamentStatus[] = [
  'SCHEDULED',
  'REG_OPEN',
  'REG_CLOSED',
  'LIVE',
  'IN_REVIEW',
  'FINAL',
  'REWARDS_APPROVED',
  'CLOSED',
  'CANCELLED',
];

export const TournamentFormat = {
  MASS: 'MASS',
  KNOCKOUT: 'KNOCKOUT',
  LEAGUE: 'LEAGUE',
  DUEL: 'DUEL',
} as const;
export type TournamentFormat = (typeof TournamentFormat)[keyof typeof TournamentFormat];

export const EntryMode = { FREE: 'FREE', PAID: 'PAID' } as const;
export type EntryMode = (typeof EntryMode)[keyof typeof EntryMode];

export const RewardType = {
  NONE: 'NONE',
  CASH: 'CASH',
  VOUCHER: 'VOUCHER',
  SCHOLARSHIP: 'SCHOLARSHIP',
  MERCHANDISE: 'MERCHANDISE',
  MIXED: 'MIXED',
} as const;
export type RewardType = (typeof RewardType)[keyof typeof RewardType];

export const FundingSource = {
  PLATFORM: 'PLATFORM',
  SPONSOR: 'SPONSOR',
  ENTRY_FEES: 'ENTRY_FEES',
} as const;
export type FundingSource = (typeof FundingSource)[keyof typeof FundingSource];

export const BannerLinkType = {
  NONE: 'NONE',
  TOURNAMENT: 'TOURNAMENT',
  EXAM: 'EXAM',
  SERIES: 'SERIES',
  URL: 'URL',
} as const;
export type BannerLinkType = (typeof BannerLinkType)[keyof typeof BannerLinkType];

export const HomeSectionKey = {
  LIVE_TOURNAMENTS: 'LIVE_TOURNAMENTS',
  CONTINUE_LEARNING: 'CONTINUE_LEARNING',
  DAILY_MISSIONS: 'DAILY_MISSIONS',
  POPULAR_EXAMS: 'POPULAR_EXAMS',
  LEADERBOARD: 'LEADERBOARD',
} as const;
export type HomeSectionKey = (typeof HomeSectionKey)[keyof typeof HomeSectionKey];
