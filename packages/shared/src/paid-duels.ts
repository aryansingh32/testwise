import { z } from 'zod';
import { eligibilitySchema } from './schemas';

/** In-app currency name; coins are never legal tender and are only redeemable through the rewards catalogue. */
export const paidDuelOfferSchema = z
  .object({
    titleEn: z.string().trim().min(3).max(80),
    titleHi: z.string().trim().max(80).optional().nullable(),
    examId: z.string().optional().nullable(),
    entryCoins: z.number().int().min(1).max(100_000),
    /** What the winner receives. Up to both entries (no platform fee); less than that leaves a fee. */
    prizeCoins: z.number().int().min(0).max(200_000),
    questionCount: z.number().int().min(3).max(15),
    secondsPerQuestion: z.number().int().min(5).max(90),
    /** How many identical rooms to create. */
    rooms: z.number().int().min(1).max(200),
    eligibility: eligibilitySchema.default({}),
    status: z.enum(['DRAFT', 'LIVE']).default('DRAFT'),
  })
  .refine((o) => o.prizeCoins <= o.entryCoins * 2, { path: ['prizeCoins'], message: 'The prize cannot be more than both entries together' });
export type PaidDuelOfferInput = z.infer<typeof paidDuelOfferSchema>;

export const paidDuelOfferUpdateSchema = z.object({
  titleEn: z.string().trim().min(3).max(80).optional(),
  titleHi: z.string().trim().max(80).optional().nullable(),
  status: z.enum(['DRAFT', 'LIVE', 'PAUSED', 'CLOSED']).optional(),
  eligibility: eligibilitySchema.optional(),
  addRooms: z.number().int().min(1).max(200).optional(),
});
export type PaidDuelOfferUpdate = z.infer<typeof paidDuelOfferUpdateSchema>;

export interface PaidDuelOfferDto {
  id: string;
  titleEn: string;
  titleHi: string | null;
  entryCoins: number;
  prizeCoins: number;
  feeCoins: number;
  questionCount: number;
  secondsPerQuestion: number;
  examName: { en: string; hi: string } | null;
  openRooms: number;
  waitingRooms: number;
  playingRooms: number;
  finishedRooms: number;
  eligible: boolean;
  ineligibleReasonEn: string | null;
  ineligibleReasonHi: string | null;
  /** The room this student is currently in for this offer, if any. */
  myRoom: { id: string; status: 'WAITING' | 'MATCHED' | 'ACTIVE'; duelId: string | null; waitingUntil: string | null } | null;
}

export interface PaidDuelJoinResultDto {
  roomId: string;
  status: 'WAITING' | 'MATCHED';
  duelId: string | null;
  waitingUntil: string | null;
  balanceAfter: number;
}

export interface AdminPaidDuelOfferDto extends Omit<PaidDuelOfferDto, 'eligible' | 'ineligibleReasonEn' | 'ineligibleReasonHi' | 'myRoom'> {
  status: 'DRAFT' | 'LIVE' | 'PAUSED' | 'CLOSED';
  examId: string | null;
  eligibility: z.infer<typeof eligibilitySchema>;
  cancelledRooms: number;
  /** Coins currently held in escrow for waiting/playing rooms. */
  escrowCoins: number;
  /** Fees kept by the platform from finished rooms. */
  feesCoins: number;
  createdAt: string;
  rooms: { id: string; seq: number; status: string; playerA: string | null; playerB: string | null; winner: string | null; waitingUntil: string | null }[];
}

export interface CoinRewardsDto {
  enabled: boolean;
  daily: { cycleDay: number; rewards: number[]; claimable: boolean; claimedToday: boolean; streak: number; todayCoins: number };
  level: { level: number; xp: number; xpIntoLevel: number; xpForNext: number; progressPct: number };
  milestones: { days: number; coins: number; reached: boolean }[];
  earnedTodayCoins: number;
  dailyEarnCap: number;
}

/** Level n needs xpPerLevel × n(n−1)/2 total XP, so levels slow down gently. */
export function levelForXp(xp: number, xpPerLevel: number) {
  let level = 1;
  while (xp >= (xpPerLevel * (level + 1) * level) / 2) level++;
  const floor = (xpPerLevel * level * (level - 1)) / 2;
  const next = (xpPerLevel * (level + 1) * level) / 2;
  return { level, xpIntoLevel: xp - floor, xpForNext: next - floor, progressPct: Math.min(100, Math.round(((xp - floor) / (next - floor)) * 100)) };
}
