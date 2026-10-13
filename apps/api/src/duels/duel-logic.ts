import { randomInt } from 'crypto';
/** Pure duel rules: scoring, Elo ratings, tiers and bot behaviour. */

export interface DuelRules {
  pointsCorrect: number;
  maxSpeedBonus: number;
  secondsPerQuestion: number;
}

/** Correct answers earn base points plus a bonus for speed; wrong or missing answers earn 0. */
export function answerPoints(correct: boolean, timeMs: number, rules: DuelRules): number {
  if (!correct) return 0;
  const total = rules.secondsPerQuestion * 1000;
  const remaining = Math.max(0, Math.min(1, (total - timeMs) / total));
  return rules.pointsCorrect + Math.round(rules.maxSpeedBonus * remaining);
}

export function expectedScore(rating: number, opponent: number) {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

/** Small deterministic PRNG for reproducible, server-only bot decisions. */
export function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Elo update for one player. result: 1 win, 0.5 draw, 0 loss. Ratings never go below 100. */
export function eloUpdate(rating: number, opponent: number, result: 0 | 0.5 | 1, k: number) {
  return Math.max(100, Math.round(rating + k * (result - expectedScore(rating, opponent))));
}

export interface Tier {
  name: string;
  nameHi: string;
  minRating: number;
  color: string;
}

export function tierFor(rating: number, tiers: Tier[]) {
  const sorted = [...tiers].sort((a, b) => a.minRating - b.minRating);
  let idx = 0;
  sorted.forEach((t, i) => {
    if (rating >= t.minRating) idx = i;
  });
  return { tier: sorted[idx], next: sorted[idx + 1] ?? null, index: idx };
}

export interface BotSettings {
  knowsAnswers: boolean;
  adaptiveToPlayerRating: boolean;
  accuracyEasy: number;
  accuracyMedium: number;
  accuracyHard: number;
  minAnswerSeconds: number;
  maxAnswerSeconds: number;
  skipProbability: number;
}

/**
 * Decide how a bot answers one question: when (ms) and which option, or null to skip.
 * `rand` is injectable for tests.
 */
export function botAnswer(
  q: { difficulty: 'EASY' | 'MEDIUM' | 'HARD'; labels: string[]; correct: string },
  bot: BotSettings,
  ctx: { playerRating: number; secondsPerQuestion: number; performanceOffset?: number },
  rand: () => number = Math.random,
): { timeMs: number; label: string | null } {
  const limit = ctx.secondsPerQuestion * 1000 - 400;
  const min = Math.min(bot.minAnswerSeconds * 1000, limit);
  const max = Math.min(Math.max(bot.maxAnswerSeconds * 1000, min), limit);
  const timeMs = Math.round(min + rand() * (max - min));
  if (rand() < bot.skipProbability) return { timeMs: limit, label: null };
  if (!bot.knowsAnswers) return { timeMs, label: q.labels[Math.floor(rand() * q.labels.length)] };
  let accuracy = q.difficulty === 'EASY' ? bot.accuracyEasy : q.difficulty === 'HARD' ? bot.accuracyHard : bot.accuracyMedium;
  if (bot.adaptiveToPlayerRating) accuracy += Math.max(-0.25, Math.min(0.25, (ctx.playerRating - 1200) / 1000));
  accuracy += Math.max(-0.1, Math.min(0.1, ctx.performanceOffset ?? 0));
  accuracy = Math.max(0.05, Math.min(0.98, accuracy));
  if (rand() < accuracy) return { timeMs, label: q.correct };
  const wrong = q.labels.filter((l) => l !== q.correct);
  return { timeMs, label: wrong[Math.floor(rand() * wrong.length)] ?? q.correct };
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function inviteCode(len = 6) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** Opaque opponent id that looks like a normal account id. */
export function pseudoId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = 'c';
  for (let i = 0; i < 24; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
