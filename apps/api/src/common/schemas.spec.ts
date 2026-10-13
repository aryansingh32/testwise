import { prizePoolFromTiers, questionSchema, tournamentSchema, winnerCountFromTiers } from '@testwise/shared';
import { ageOn, isMinor } from '../auth/user-mapper';

const baseQuestion = {
  type: 'MCQ_SINGLE',
  difficulty: 'EASY',
  subjectId: 'sub',
  textEn: 'What is 2 + 2?',
  options: [
    { label: 'A', textEn: '3' },
    { label: 'B', textEn: '4' },
  ],
  correctLabels: ['B'],
};

describe('questionSchema', () => {
  it('accepts a valid single-answer question', () => {
    expect(questionSchema.safeParse(baseQuestion).success).toBe(true);
  });

  it('rejects two correct options on a single-answer question', () => {
    const r = questionSchema.safeParse({ ...baseQuestion, correctLabels: ['A', 'B'] });
    expect(r.success).toBe(false);
  });

  it('rejects a correct label that is not an option', () => {
    const r = questionSchema.safeParse({ ...baseQuestion, correctLabels: ['C'] });
    expect(r.success).toBe(false);
  });

  it('requires a numeric answer for NUMERIC questions', () => {
    expect(questionSchema.safeParse({ ...baseQuestion, type: 'NUMERIC', options: [], correctLabels: [] }).success).toBe(false);
    expect(questionSchema.safeParse({ ...baseQuestion, type: 'NUMERIC', options: [], correctLabels: [], correctNumeric: 4 }).success).toBe(true);
  });
});

const baseTournament = {
  slug: 'weekend-war',
  titleEn: 'Weekend War',
  format: 'MASS',
  entryMode: 'FREE',
  rewardType: 'SCHOLARSHIP',
  fundingSource: 'SPONSOR',
  maxParticipants: 100,
  registrationOpensAt: '2026-10-01T10:00:00.000Z',
  registrationClosesAt: '2026-10-05T10:00:00.000Z',
  startsAt: '2026-10-05T12:00:00.000Z',
  endsAt: '2026-10-05T14:00:00.000Z',
  durationMinutes: 60,
  questionCount: 50,
};

describe('tournamentSchema', () => {
  it('accepts a valid free tournament', () => {
    expect(tournamentSchema.safeParse(baseTournament).success).toBe(true);
  });

  it('rejects a schedule that ends before it starts', () => {
    expect(tournamentSchema.safeParse({ ...baseTournament, endsAt: '2026-10-05T11:00:00.000Z' }).success).toBe(false);
  });

  it('rejects an entry fee on a free tournament and a missing fee on a paid one', () => {
    expect(tournamentSchema.safeParse({ ...baseTournament, entryFeePaise: 4900 }).success).toBe(false);
    expect(tournamentSchema.safeParse({ ...baseTournament, entryMode: 'PAID' }).success).toBe(false);
  });

  it('rejects overlapping prize ranks', () => {
    const r = tournamentSchema.safeParse({
      ...baseTournament,
      prizeTiers: [
        { fromRank: 1, toRank: 3 },
        { fromRank: 3, toRank: 10 },
      ],
    });
    expect(r.success).toBe(false);
  });
});

describe('prize helpers', () => {
  const tiers = [
    { fromRank: 1, toRank: 1, amountPaise: 500000 },
    { fromRank: 2, toRank: 5, amountPaise: 100000 },
  ];
  it('sums cash across every rank in each range', () => {
    expect(prizePoolFromTiers(tiers)).toBe(900000);
    expect(winnerCountFromTiers(tiers)).toBe(5);
  });
});

describe('age helpers', () => {
  it('computes age around birthdays', () => {
    expect(ageOn(new Date('2008-10-12'), new Date('2026-10-11'))).toBe(17);
    expect(ageOn(new Date('2008-10-11'), new Date('2026-10-11'))).toBe(18);
  });

  it('treats school students without a date of birth as minors', () => {
    expect(isMinor({ dateOfBirth: null, audience: 'SCHOOL' })).toBe(true);
    expect(isMinor({ dateOfBirth: null, audience: 'EXAM' })).toBe(false);
  });
});
