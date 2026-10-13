import type { Language, QuestionType, TournamentStatus } from './enums';

// ---------- Tests & attempts ----------

export type AttemptStatus = 'IN_PROGRESS' | 'SUBMITTED' | 'AUTO_SUBMITTED';
export type AnswerKeyPolicy = 'ON_SUBMIT' | 'AFTER_WINDOW' | 'AFTER_FINAL' | 'NEVER';

export interface PaperOption {
  label: string;
  textEn: string;
  textHi: string | null;
}

export interface PaperQuestion {
  id: string;
  sectionId: string;
  type: QuestionType;
  textEn: string;
  textHi: string | null;
  imageUrl: string | null;
  options: PaperOption[];
  marks: number;
  negativeMarks: number;
}

export interface PaperSection {
  id: string;
  titleEn: string;
  titleHi: string | null;
}

export interface SavedAnswer {
  questionId: string;
  selectedLabels: string[];
  numericValue: number | null;
  markedForReview: boolean;
  timeSpentSec: number;
}

/** What the exam player receives. Never contains answers. */
export interface AttemptPaperDto {
  attemptId: string;
  testId: string;
  tournamentId: string | null;
  titleEn: string;
  titleHi: string | null;
  instructionsEn: string | null;
  instructionsHi: string | null;
  status: AttemptStatus;
  language: Language;
  allowLanguageSwitch: boolean;
  startedAt: string;
  deadlineAt: string;
  serverNow: string;
  sections: PaperSection[];
  questions: PaperQuestion[];
  answers: SavedAnswer[];
  /** Present when this attempt is proctored. */
  proctor: { mode: 'BASIC' | 'AI' | 'LIVE'; status: 'ACTIVE' | 'ENDED' | 'TERMINATED'; liveRequested: boolean; features: import('./proctoring').ProctorFeatures | null } | null;
}

export interface QuestionReview extends PaperQuestion {
  selectedLabels: string[];
  numericValue: number | null;
  isCorrect: boolean | null;
  marksAwarded: number;
  correctLabels: string[] | null;
  correctNumeric: number | null;
  solutionEn: string | null;
  solutionHi: string | null;
}

export interface SectionScore {
  sectionId: string;
  titleEn: string;
  titleHi: string | null;
  score: number;
  maxScore: number;
  correct: number;
  wrong: number;
  skipped: number;
}

export interface AttemptResultDto {
  attemptId: string;
  testId: string;
  tournamentId: string | null;
  tournamentSlug: string | null;
  titleEn: string;
  titleHi: string | null;
  status: AttemptStatus;
  submittedAt: string | null;
  score: number;
  maxScore: number;
  correct: number;
  wrong: number;
  skipped: number;
  accuracy: number;
  timeTakenSec: number;
  sections: SectionScore[];
  /** Null when the answer key is not released yet under the test's policy. */
  review: QuestionReview[] | null;
  answerKeyMessageEn: string | null;
  answerKeyMessageHi: string | null;
  xpEarned: number;
}

export interface TestCardDto {
  id: string;
  titleEn: string;
  titleHi: string | null;
  kind: string;
  durationMinutes: number;
  questionCount: number;
  totalMarks: number;
  maxAttempts: number;
  attemptsUsed: number;
  locked: boolean;
  freePreview: boolean;
  inProgressAttemptId: string | null;
  lastAttempt: { id: string; score: number | null; maxScore: number | null; submittedAt: string | null } | null;
}

// ---------- Store ----------

export interface SeriesCardDto {
  id: string;
  slug: string;
  titleEn: string;
  titleHi: string | null;
  examName: { en: string; hi: string | null } | null;
  pricePaise: number;
  mrpPaise: number | null;
  color: string;
  imageUrl: string | null;
  badgeEn: string | null;
  badgeHi: string | null;
  testCount: number;
  enrolled: boolean;
  featured: boolean;
}

export interface SeriesDetailDto extends SeriesCardDto {
  descriptionEn: string | null;
  descriptionHi: string | null;
  validityDays: number;
  features: { en: string; hi?: string | null }[];
  enrolledUntil: string | null;
  enrolledCount: number;
  tests: TestCardDto[];
}

// ---------- Orders ----------

export type OrderStatus = 'CREATED' | 'PAID' | 'FAILED' | 'CANCELLED' | 'REFUND_PENDING' | 'REFUNDED';

export interface OrderDto {
  id: string;
  receiptNo: string;
  kind: 'TOURNAMENT_ENTRY' | 'SERIES_PURCHASE' | 'COIN_TOPUP';
  descriptionEn: string;
  amountPaise: number;
  discountPaise: number;
  couponCode: string | null;
  status: OrderStatus;
  provider: string;
  providerPaymentId: string | null;
  paidAt: string | null;
  createdAt: string;
  refunds: { id: string; amountPaise: number; status: string; reason: string; createdAt: string }[];
}

/** Returned when an order needs payment. `provider` tells the app which checkout to open. */
export interface CheckoutDto {
  order: OrderDto;
  provider: 'MOCK' | 'RAZORPAY' | 'PAYTM';
  providerOrderId: string | null;
  /** Hosted payment page to open (Razorpay Payment Link). */
  checkoutUrl: string | null;
  amountPaise: number;
  /** Set when nothing is payable (free or 100% coupon): the purchase is already complete. */
  completed: boolean;
}

// ---------- Tournament participation & results ----------

export type RegistrationState = 'NONE' | 'PENDING_PAYMENT' | 'CONFIRMED' | 'WAITLISTED' | 'CANCELLED';

export interface MyTournamentStateDto {
  registration: {
    id: string;
    status: RegistrationState;
    orderId: string | null;
    createdAt: string;
  } | null;
  eligible: boolean;
  ineligibleReasonEn: string | null;
  ineligibleReasonHi: string | null;
  canRegister: boolean;
  canCancel: boolean;
  canStart: boolean;
  attempt: { id: string; status: AttemptStatus; score: number | null } | null;
  resultAvailable: boolean;
}

export interface LeaderboardRowDto {
  rank: number | null;
  userId: string;
  displayName: string;
  score: number;
  accuracy: number;
  timeTakenSec: number;
  disqualified: boolean;
  isMe: boolean;
}

export interface TournamentResultDto {
  tournamentId: string;
  slug: string;
  titleEn: string;
  titleHi: string | null;
  status: TournamentStatus;
  resultStatus: 'LIVE' | 'PROVISIONAL' | 'FINAL' | 'NONE';
  version: number | null;
  publishedAt: string | null;
  verifyUrl: string | null;
  appealDeadline: string | null;
  participants: number;
  leaderboard: LeaderboardRowDto[];
  me: (LeaderboardRowDto & {
    percentile: number | null;
    rewardEn: string | null;
    rewardHi: string | null;
    rewardPaise: number;
    rewardStatus: 'NONE' | 'ELIGIBLE' | 'APPROVED' | 'PAID' | 'WITHHELD';
    dqReason: string | null;
    attemptId: string;
  }) | null;
}

export interface MyTournamentRowDto {
  id: string;
  slug: string;
  titleEn: string;
  titleHi: string | null;
  status: TournamentStatus;
  startsAt: string;
  endsAt: string;
  bannerColor: string;
  registrationStatus: RegistrationState;
  attemptStatus: AttemptStatus | null;
  rank: number | null;
  score: number | null;
}

// ---------- Engagement ----------

export interface MissionDto {
  id: string;
  titleEn: string;
  titleHi: string;
  target: number;
  progress: number;
  xp: number;
  done: boolean;
}

export interface NotificationDto {
  id: string;
  category?: string;
  titleEn: string;
  titleHi: string | null;
  bodyEn: string;
  bodyHi: string | null;
  link: string | null;
  createdAt: string;
  read: boolean;
}

export interface FaqDto {
  id: string;
  category: string;
  questionEn: string;
  questionHi: string | null;
  answerEn: string;
  answerHi: string | null;
}

export interface TicketDto {
  id: string;
  category: string;
  subject: string;
  status: 'OPEN' | 'ANSWERED' | 'CLOSED';
  createdAt: string;
  updatedAt: string;
  messages: { id: string; fromAdmin: boolean; body: string; createdAt: string }[];
}

export interface ContinueItemDto {
  kind: 'ATTEMPT' | 'SERIES';
  id: string;
  titleEn: string;
  titleHi: string | null;
  color: string;
  progress: number;
  total: number;
  attemptId: string | null;
  seriesSlug: string | null;
}

// ---------- Duels ----------

export interface DuelPlayerDto {
  /** Opaque id; synthetic ids keep bot identity indistinguishable from a player. */
  id: string;
  name: string;
  rating: number;
  color: string;
  tier: string;
}

export interface DuelQuestionDto {
  index: number;
  total: number;
  textEn: string;
  textHi: string | null;
  imageUrl: string | null;
  options: PaperOption[];
  endsAt: string;
  serverNow: string;
}

export interface DuelScoreDto {
  you: number;
  opponent: number;
}

export interface DuelQuestionResultDto {
  index: number;
  correctLabels: string[];
  yourLabels: string[];
  yourPoints: number;
  opponentLabels: string[];
  opponentPoints: number;
  scores: DuelScoreDto;
}

export interface DuelFinishedDto {
  duelId: string;
  outcome: 'WIN' | 'LOSS' | 'DRAW';
  scores: DuelScoreDto;
  ratingBefore: number;
  ratingAfter: number;
  xpEarned: number;
  opponent: DuelPlayerDto;
  rematchAvailableUntil: string;
}

export interface DuelProfileDto {
  rating: number;
  tier: { name: string; nameHi: string; color: string; nextName: string | null; nextAt: number | null };
  wins: number;
  losses: number;
  draws: number;
  streak: number;
  rank: number | null;
}

export interface DuelHistoryDto {
  id: string;
  opponentName: string;
  outcome: 'WIN' | 'LOSS' | 'DRAW' | 'ABANDONED';
  yourScore: number;
  opponentScore: number;
  ratingChange: number;
  finishedAt: string | null;
}

export interface DuelLeaderRowDto {
  rank: number;
  userId: string;
  name: string;
  rating: number;
  tier: string;
  tierColor: string;
  wins: number;
  isMe: boolean;
}
