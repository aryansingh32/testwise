import type { PrizeTier } from './schemas';

/** Format paise as an Indian rupee string, e.g. 150000 -> "₹1,500". */
export function formatRupees(paise: number): string {
  const rupees = paise / 100;
  const whole = rupees % 1 === 0;
  return '₹' + rupees.toLocaleString('en-IN', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
}

/** Total cash in a prize table, counting every rank in each range. */
export function prizePoolFromTiers(tiers: PrizeTier[]): number {
  return tiers.reduce((sum, t) => sum + t.amountPaise * (t.toRank - t.fromRank + 1), 0);
}

/** Number of ranks that receive any reward. */
export function winnerCountFromTiers(tiers: PrizeTier[]): number {
  return tiers.reduce((sum, t) => sum + (t.toRank - t.fromRank + 1), 0);
}

/** Pick the localised value, falling back to English when Hindi is missing. */
export function pickLang<T extends string | null | undefined>(en: T, hi: T, lang: 'EN' | 'HI'): T {
  return lang === 'HI' && hi ? hi : en;
}
