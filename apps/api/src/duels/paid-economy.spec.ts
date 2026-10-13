import { levelForXp, paidDuelOfferSchema } from '@testwise/shared';
import { audienceReason } from '../common/eligibility';

describe('level curve', () => {
  it('starts at level 1 and slows down', () => {
    expect(levelForXp(0, 100).level).toBe(1);
    expect(levelForXp(99, 100).level).toBe(1);
    expect(levelForXp(100, 100).level).toBe(2);
    expect(levelForXp(299, 100).level).toBe(2);
    expect(levelForXp(300, 100).level).toBe(3);
    expect(levelForXp(600, 100).level).toBe(4);
  });
  it('reports progress inside the level', () => {
    const l = levelForXp(150, 100); // level 2: 100..300
    expect(l).toMatchObject({ level: 2, xpIntoLevel: 50, xpForNext: 200, progressPct: 25 });
  });
});

describe('offer validation', () => {
  const base = { titleEn: 'Quick duel', entryCoins: 50, prizeCoins: 100, questionCount: 5, secondsPerQuestion: 20, rooms: 20 };
  it('accepts prize 75 or 100 for entry 50', () => {
    expect(paidDuelOfferSchema.safeParse({ ...base, prizeCoins: 75 }).success).toBe(true);
    expect(paidDuelOfferSchema.safeParse(base).success).toBe(true);
  });
  it('rejects a prize bigger than both entries (the platform cannot pay out more than it holds)', () => {
    expect(paidDuelOfferSchema.safeParse({ ...base, prizeCoins: 101 }).success).toBe(false);
  });
  it('rejects zero entry and absurd room counts', () => {
    expect(paidDuelOfferSchema.safeParse({ ...base, entryCoins: 0 }).success).toBe(false);
    expect(paidDuelOfferSchema.safeParse({ ...base, rooms: 5000 }).success).toBe(false);
  });
});

describe('who can join (audience)', () => {
  const student = { audience: 'SCHOOL' as const, classLevel: 9, dateOfBirth: new Date('2010-01-01') };
  const aspirant = { audience: 'EXAM' as const, classLevel: null, dateOfBirth: new Date('2000-01-01') };
  it('empty eligibility means everyone', () => {
    expect(audienceReason({}, student, [])).toBeNull();
    expect(audienceReason({ audience: [], classLevels: [], examIds: [] }, aspirant, [])).toBeNull();
  });
  it('restricts by audience', () => {
    expect(audienceReason({ audience: ['EXAM'] }, student, [])).not.toBeNull();
    expect(audienceReason({ audience: ['EXAM'] }, aspirant, [])).toBeNull();
    expect(audienceReason({ audience: ['SCHOOL'] }, aspirant, [])).not.toBeNull();
  });
  it('restricts by class', () => {
    expect(audienceReason({ classLevels: [8, 9] }, student, [])).toBeNull();
    expect(audienceReason({ classLevels: [10] }, student, [])).not.toBeNull();
  });
  it('restricts by chosen exam', () => {
    expect(audienceReason({ examIds: ['ssc'] }, aspirant, ['ssc', 'jee'])).toBeNull();
    expect(audienceReason({ examIds: ['ssc'] }, aspirant, ['jee'])).not.toBeNull();
  });
  it('restricts by age and needs a date of birth for it', () => {
    expect(audienceReason({ minAge: 18 }, student, [])).not.toBeNull();
    expect(audienceReason({ minAge: 18 }, aspirant, [])).toBeNull();
    expect(audienceReason({ minAge: 18 }, { ...aspirant, dateOfBirth: null }, [])).not.toBeNull();
  });
});
