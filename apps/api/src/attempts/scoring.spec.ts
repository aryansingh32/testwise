import { rankEntries, scorePaper, scoreQuestion, seededShuffle, type PaperKeyQuestion } from './scoring';

const q = (over: Partial<PaperKeyQuestion>): PaperKeyQuestion => ({
  id: 'q', sectionId: 's1', type: 'MCQ_SINGLE', textEn: '', textHi: null, imageUrl: null,
  options: [{ label: 'A', textEn: 'a', textHi: null }, { label: 'B', textEn: 'b', textHi: null }, { label: 'C', textEn: 'c', textHi: null }],
  marks: 2, negativeMarks: 0.5, correctLabels: ['B'], correctNumeric: null, numericTolerance: null, solutionEn: null, solutionHi: null, ...over,
});

describe('scoreQuestion', () => {
  it('awards marks for the right single answer and deducts for a wrong one', () => {
    expect(scoreQuestion(q({}), { questionId: 'q', selectedLabels: ['B'], numericValue: null }, 'ALL_OR_NOTHING').marksAwarded).toBe(2);
    expect(scoreQuestion(q({}), { questionId: 'q', selectedLabels: ['A'], numericValue: null }, 'ALL_OR_NOTHING').marksAwarded).toBe(-0.5);
  });

  it('gives zero for unattempted questions', () => {
    const s = scoreQuestion(q({}), undefined, 'ALL_OR_NOTHING');
    expect(s).toMatchObject({ attempted: false, isCorrect: null, marksAwarded: 0 });
  });

  it('scores multi-select all-or-nothing and partial', () => {
    const multi = q({ type: 'MCQ_MULTI', correctLabels: ['A', 'C'], marks: 4, negativeMarks: 1 });
    expect(scoreQuestion(multi, { questionId: 'q', selectedLabels: ['A', 'C'], numericValue: null }, 'ALL_OR_NOTHING').marksAwarded).toBe(4);
    expect(scoreQuestion(multi, { questionId: 'q', selectedLabels: ['A'], numericValue: null }, 'ALL_OR_NOTHING').marksAwarded).toBe(-1);
    expect(scoreQuestion(multi, { questionId: 'q', selectedLabels: ['A'], numericValue: null }, 'PARTIAL').marksAwarded).toBe(2);
    expect(scoreQuestion(multi, { questionId: 'q', selectedLabels: ['A', 'B'], numericValue: null }, 'PARTIAL').marksAwarded).toBe(-1);
  });

  it('accepts numeric answers within tolerance', () => {
    const num = q({ type: 'NUMERIC', options: [], correctLabels: [], correctNumeric: 2.5, numericTolerance: 0.01 });
    expect(scoreQuestion(num, { questionId: 'q', selectedLabels: [], numericValue: 2.505 }, 'ALL_OR_NOTHING').isCorrect).toBe(true);
    expect(scoreQuestion(num, { questionId: 'q', selectedLabels: [], numericValue: 2.6 }, 'ALL_OR_NOTHING').isCorrect).toBe(false);
  });
});

describe('scorePaper', () => {
  it('totals score, accuracy and sections', () => {
    const paper = {
      sections: [{ id: 's1', titleEn: 'One', titleHi: null }, { id: 's2', titleEn: 'Two', titleHi: null }],
      questions: [q({ id: 'a' }), q({ id: 'b' }), q({ id: 'c', sectionId: 's2' })],
    };
    const r = scorePaper(paper, [
      { questionId: 'a', selectedLabels: ['B'], numericValue: null },
      { questionId: 'b', selectedLabels: ['A'], numericValue: null },
    ], 'ALL_OR_NOTHING');
    expect(r).toMatchObject({ score: 1.5, maxScore: 6, correct: 1, wrong: 1, skipped: 1, accuracy: 50 });
    expect(r.sections.map((s) => s.score)).toEqual([1.5, 0]);
  });
});

describe('seededShuffle', () => {
  it('is deterministic per seed and keeps every item', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(seededShuffle(items, 'x')).toEqual(seededShuffle(items, 'x'));
    expect([...seededShuffle(items, 'y')].sort()).toEqual(items);
  });
});

describe('rankEntries', () => {
  const t = (s: number) => new Date(1_700_000_000_000 + s * 1000);
  it('applies tie-breaks: score, accuracy, time, submission', () => {
    const ranked = rankEntries([
      { userId: 'a', score: 10, accuracy: 80, timeTakenSec: 300, submittedAt: t(5), disqualified: false },
      { userId: 'b', score: 10, accuracy: 90, timeTakenSec: 400, submittedAt: t(1), disqualified: false },
      { userId: 'c', score: 10, accuracy: 80, timeTakenSec: 200, submittedAt: t(9), disqualified: false },
      { userId: 'd', score: 12, accuracy: 50, timeTakenSec: 900, submittedAt: t(2), disqualified: false },
      { userId: 'e', score: 99, accuracy: 100, timeTakenSec: 10, submittedAt: t(0), disqualified: true },
    ]);
    expect(ranked.map((r) => [r.userId, r.rank])).toEqual([['d', 1], ['b', 2], ['c', 3], ['a', 4], ['e', null]]);
    expect(ranked[0].percentile).toBe(100);
    expect(ranked[3].percentile).toBe(0);
  });

  it('gives exact ties the same rank', () => {
    const same = { score: 5, accuracy: 50, timeTakenSec: 100, submittedAt: t(1), disqualified: false };
    const ranked = rankEntries([{ userId: 'a', ...same }, { userId: 'b', ...same }, { userId: 'c', ...same, score: 1 }]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3]);
  });
});
