import { answerPoints, botAnswer, eloUpdate, expectedScore, tierFor, type BotSettings } from './duel-logic';

const rules = { pointsCorrect: 10, maxSpeedBonus: 10, secondsPerQuestion: 20 };
const bot: BotSettings = { knowsAnswers: true, adaptiveToPlayerRating: false, accuracyEasy: 0.9, accuracyMedium: 0.6, accuracyHard: 0.3, minAnswerSeconds: 4, maxAnswerSeconds: 10, skipProbability: 0 };
const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]; };

describe('duel scoring', () => {
  it('rewards correct answers with a speed bonus', () => {
    expect(answerPoints(true, 0, rules)).toBe(20);
    expect(answerPoints(true, 10_000, rules)).toBe(15);
    expect(answerPoints(true, 20_000, rules)).toBe(10);
    expect(answerPoints(false, 1000, rules)).toBe(0);
  });
});

describe('elo', () => {
  it('moves ratings towards results and is symmetric for equal players', () => {
    expect(expectedScore(1200, 1200)).toBeCloseTo(0.5);
    expect(eloUpdate(1200, 1200, 1, 32)).toBe(1216);
    expect(eloUpdate(1200, 1200, 0, 32)).toBe(1184);
    expect(eloUpdate(1200, 1200, 0.5, 32)).toBe(1200);
    expect(eloUpdate(1500, 1200, 1, 32)).toBeLessThan(1508);
    expect(eloUpdate(100, 2000, 0, 32)).toBe(100);
  });
});

describe('tiers', () => {
  const tiers = [
    { name: 'Bronze', nameHi: '', minRating: 0, color: '#000000' },
    { name: 'Silver', nameHi: '', minRating: 1250, color: '#000000' },
    { name: 'Gold', nameHi: '', minRating: 1400, color: '#000000' },
  ];
  it('finds the current and next tier', () => {
    expect(tierFor(1200, tiers).tier.name).toBe('Bronze');
    expect(tierFor(1200, tiers).next?.name).toBe('Silver');
    expect(tierFor(1450, tiers).tier.name).toBe('Gold');
    expect(tierFor(1450, tiers).next).toBeNull();
  });
});

describe('bot answers', () => {
  const q = { difficulty: 'EASY' as const, labels: ['A', 'B', 'C', 'D'], correct: 'B' };
  it('answers correctly when the roll is under its accuracy, within the time window', () => {
    const a = botAnswer(q, bot, { playerRating: 1200, secondsPerQuestion: 20 }, seq(0.5, 0.9, 0.1));
    expect(a.label).toBe('B');
    expect(a.timeMs).toBe(7000);
  });
  it('picks a wrong option when the roll misses', () => {
    const a = botAnswer({ ...q, difficulty: 'HARD' }, bot, { playerRating: 1200, secondsPerQuestion: 20 }, seq(0, 0.9, 0.95, 0));
    expect(a.label).not.toBe('B');
  });
  it('guesses when it does not know answers, and can skip', () => {
    const guess = botAnswer(q, { ...bot, knowsAnswers: false }, { playerRating: 1200, secondsPerQuestion: 20 }, seq(0, 0.9, 0.0));
    expect(guess.label).toBe('A');
    const skip = botAnswer(q, { ...bot, skipProbability: 1 }, { playerRating: 1200, secondsPerQuestion: 20 }, seq(0.2, 0.1));
    expect(skip.label).toBeNull();
  });
  it('never answers after the question closes', () => {
    const a = botAnswer(q, { ...bot, minAnswerSeconds: 60, maxAnswerSeconds: 90 }, { playerRating: 1200, secondsPerQuestion: 5 }, seq(1, 0.9, 0.1));
    expect(a.timeMs).toBeLessThan(5000);
  });
});
