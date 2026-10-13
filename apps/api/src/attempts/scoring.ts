/** Server-side scoring. Pure functions so they can be unit-tested and re-run for corrections. */

export interface PaperKeyQuestion {
  id: string;
  sectionId: string;
  type: 'MCQ_SINGLE' | 'MCQ_MULTI' | 'NUMERIC';
  textEn: string;
  textHi: string | null;
  imageUrl: string | null;
  options: { label: string; textEn: string; textHi: string | null }[];
  marks: number;
  negativeMarks: number;
  correctLabels: string[];
  correctNumeric: number | null;
  numericTolerance: number | null;
  solutionEn: string | null;
  solutionHi: string | null;
}

export interface FrozenPaper {
  sections: { id: string; titleEn: string; titleHi: string | null }[];
  questions: PaperKeyQuestion[];
}

export interface GivenAnswer {
  questionId: string;
  selectedLabels: string[];
  numericValue: number | null;
}

export interface QuestionScore {
  questionId: string;
  attempted: boolean;
  isCorrect: boolean | null;
  marksAwarded: number;
}

export type MultiSelectScoring = 'ALL_OR_NOTHING' | 'PARTIAL';

const round2 = (n: number) => Math.round(n * 100) / 100;

export function scoreQuestion(q: PaperKeyQuestion, a: GivenAnswer | undefined, multi: MultiSelectScoring): QuestionScore {
  if (q.type === 'NUMERIC') {
    if (!a || a.numericValue == null || Number.isNaN(a.numericValue)) return { questionId: q.id, attempted: false, isCorrect: null, marksAwarded: 0 };
    const ok = q.correctNumeric != null && Math.abs(a.numericValue - q.correctNumeric) <= (q.numericTolerance ?? 0) + 1e-9;
    return { questionId: q.id, attempted: true, isCorrect: ok, marksAwarded: ok ? q.marks : -q.negativeMarks };
  }
  const chosen = [...new Set(a?.selectedLabels ?? [])];
  if (!chosen.length) return { questionId: q.id, attempted: false, isCorrect: null, marksAwarded: 0 };
  const correct = new Set(q.correctLabels);
  if (q.type === 'MCQ_SINGLE') {
    const ok = chosen.length === 1 && correct.has(chosen[0]);
    return { questionId: q.id, attempted: true, isCorrect: ok, marksAwarded: ok ? q.marks : -q.negativeMarks };
  }
  const anyWrong = chosen.some((l) => !correct.has(l));
  const allRight = !anyWrong && chosen.length === correct.size;
  if (allRight) return { questionId: q.id, attempted: true, isCorrect: true, marksAwarded: q.marks };
  if (anyWrong || multi === 'ALL_OR_NOTHING') return { questionId: q.id, attempted: true, isCorrect: false, marksAwarded: -q.negativeMarks };
  // Partial: proportional credit for a correct subset with no wrong picks.
  return { questionId: q.id, attempted: true, isCorrect: false, marksAwarded: round2((q.marks * chosen.length) / correct.size) };
}

export function scorePaper(paper: FrozenPaper, answers: GivenAnswer[], multi: MultiSelectScoring) {
  const byId = new Map(answers.map((a) => [a.questionId, a]));
  const perQuestion = paper.questions.map((q) => scoreQuestion(q, byId.get(q.id), multi));
  const sum = (f: (s: QuestionScore, q: PaperKeyQuestion) => number) => perQuestion.reduce((t, s, i) => t + f(s, paper.questions[i]), 0);
  const correct = perQuestion.filter((s) => s.isCorrect === true).length;
  const attempted = perQuestion.filter((s) => s.attempted).length;
  const sections = paper.sections.map((sec) => {
    const idx = paper.questions.map((q, i) => (q.sectionId === sec.id ? i : -1)).filter((i) => i >= 0);
    const qs = idx.map((i) => perQuestion[i]);
    return {
      sectionId: sec.id,
      titleEn: sec.titleEn,
      titleHi: sec.titleHi,
      score: round2(qs.reduce((t, s) => t + s.marksAwarded, 0)),
      maxScore: round2(idx.reduce((t, i) => t + paper.questions[i].marks, 0)),
      correct: qs.filter((s) => s.isCorrect === true).length,
      wrong: qs.filter((s) => s.attempted && s.isCorrect !== true).length,
      skipped: qs.filter((s) => !s.attempted).length,
    };
  });
  return {
    perQuestion,
    sections,
    score: round2(sum((s) => s.marksAwarded)),
    maxScore: round2(sum((_, q) => q.marks)),
    correct,
    wrong: attempted - correct,
    skipped: paper.questions.length - attempted,
    accuracy: attempted ? round2((correct / attempted) * 100) : 0,
  };
}

/** Deterministic shuffle so a paper can be regenerated from its seed. */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const rand = () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 1_000_000) / 1_000_000;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface RankInput {
  userId: string;
  score: number;
  accuracy: number;
  timeTakenSec: number;
  submittedAt: Date;
  disqualified: boolean;
}

/** Published tie-break order: score ↓, accuracy ↓, time taken ↑, submission time ↑. Exact ties share a rank. */
export function rankEntries<T extends RankInput>(rows: T[]): (T & { rank: number | null; percentile: number | null })[] {
  const eligible = rows
    .filter((r) => !r.disqualified)
    .sort(
      (a, b) =>
        b.score - a.score || b.accuracy - a.accuracy || a.timeTakenSec - b.timeTakenSec || a.submittedAt.getTime() - b.submittedAt.getTime(),
    );
  const n = eligible.length;
  const ranked: (T & { rank: number | null; percentile: number | null })[] = [];
  eligible.forEach((r, i) => {
    const prev = ranked[i - 1];
    const tie =
      prev &&
      prev.score === r.score &&
      prev.accuracy === r.accuracy &&
      prev.timeTakenSec === r.timeTakenSec &&
      prev.submittedAt.getTime() === r.submittedAt.getTime();
    const rank = tie ? prev.rank! : i + 1;
    ranked.push({ ...r, rank, percentile: n > 1 ? Math.round(((n - rank) / (n - 1)) * 10000) / 100 : 100 });
  });
  return [...ranked, ...rows.filter((r) => r.disqualified).map((r) => ({ ...r, rank: null, percentile: null }))];
}
