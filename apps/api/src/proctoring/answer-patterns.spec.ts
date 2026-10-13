import { findCollusion, poissonBinomialTail, timingAnomalies, type AnswerRow, type AttemptRow, type QuestionMeta } from './answer-patterns';

const meta = (n: number) => new Map<string, QuestionMeta>(Array.from({ length: n }, (_, i) => [`q${i}`, { optionCount: 4, type: 'MCQ_SINGLE' as const }]));
const wrong = (q: number, label: string): AnswerRow => ({ questionId: `q${q}`, labels: [label], numericValue: null, isCorrect: false, timeSpentSec: 30, changeCount: 0 });
const attempt = (id: string, answers: AnswerRow[]): AttemptRow => ({ attemptId: id, userId: `u-${id}`, answers });
const opts = { minShared: 4, minRatio: 0.6, maxPValue: 1e-4 };

describe('poissonBinomialTail', () => {
  it('matches the binomial tail', () => {
    // P(X>=2) for 3 coin flips = 0.5
    expect(poissonBinomialTail([0.5, 0.5, 0.5], 2)).toBeCloseTo(0.5, 10);
    expect(poissonBinomialTail([0.5], 2)).toBe(0);
    expect(poissonBinomialTail([0.5], 0)).toBe(1);
  });
});

describe('findCollusion', () => {
  const same = (id: string) => attempt(id, Array.from({ length: 20 }, (_, i) => wrong(i, 'C')));
  it('flags two students with the same 20 wrong answers', () => {
    const f = findCollusion([same('a'), same('b')], meta(20), opts);
    expect(f).toHaveLength(1);
    expect(f[0].sharedWrong).toBe(20);
    expect(f[0].pValue).toBeLessThan(1e-6);
  });
  it('does not flag students whose wrong answers differ', () => {
    const b = attempt('b', Array.from({ length: 20 }, (_, i) => wrong(i, 'B')));
    expect(findCollusion([same('a'), b], meta(20), opts)).toHaveLength(0);
  });
  it('does not flag a handful of coincidences', () => {
    const a = attempt('a', [wrong(0, 'C'), wrong(1, 'C'), wrong(2, 'C'), wrong(3, 'D')]);
    const b = attempt('b', [wrong(0, 'C'), wrong(1, 'C'), wrong(2, 'C'), wrong(3, 'A')]);
    expect(findCollusion([a, b], meta(4), opts)).toHaveLength(0); // 3 shared < minShared
  });
  it('ignores a wrong answer that most of the cohort gave (a bad question, not collusion)', () => {
    const crowd = Array.from({ length: 450 }, (_, i) => attempt(`s${i}`, [wrong(0, 'C')]));
    expect(findCollusion(crowd, meta(1), { ...opts, minShared: 1, minRatio: 0.1, maxPValue: 1 })).toHaveLength(0);
  });
  it('never pairs an account with itself', () => {
    const a = same('a');
    const b = { ...same('b'), userId: a.userId };
    expect(findCollusion([a, b], meta(20), opts)).toHaveLength(0);
  });
});

describe('timingAnomalies', () => {
  const ans = (i: number, t: number, ok = true): AnswerRow => ({ questionId: `q${i}`, labels: ['A'], numericValue: null, isCorrect: ok, timeSpentSec: t, changeCount: 0 });
  it('flags a mostly-correct sub-2s run', () => {
    const r = timingAnomalies(attempt('a', Array.from({ length: 20 }, (_, i) => ans(i, 1))), new Map(), { minSecondsPerAnswer: 2 });
    expect(r.map((x) => x.type)).toContain('ANSWER_SPEED');
  });
  it('flags near-constant timing', () => {
    const r = timingAnomalies(attempt('a', Array.from({ length: 20 }, (_, i) => ans(i, 20 + (i % 2) * 0.5))), new Map(), { minSecondsPerAnswer: 2 });
    expect(r.map((x) => x.type)).toContain('ANSWER_TIMING');
  });
  it('flags quick correct answers on questions the cohort mostly missed', () => {
    const hard = new Map(Array.from({ length: 12 }, (_, i) => [`q${i}`, 0.1] as const));
    const rows = Array.from({ length: 12 }, (_, i) => ans(i, 2 + (i % 5) * 10));
    rows.forEach((r, i) => { if (i < 8) r.timeSpentSec = 2; });
    expect(timingAnomalies(attempt('a', rows), hard, { minSecondsPerAnswer: 1 }).some((x) => x.reasons[0].includes('hard questions'))).toBe(true);
  });
  it('leaves a normal human pattern alone', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ans(i, 15 + ((i * 37) % 60), i % 3 !== 0));
    expect(timingAnomalies(attempt('a', rows), new Map(), { minSecondsPerAnswer: 2 })).toHaveLength(0);
  });
  it('says nothing about very short attempts', () => {
    expect(timingAnomalies(attempt('a', [ans(0, 1), ans(1, 1)]), new Map(), { minSecondsPerAnswer: 2 })).toHaveLength(0);
  });
});
