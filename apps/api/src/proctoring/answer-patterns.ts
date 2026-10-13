/**
 * Answer-pattern analysis. Pure functions (no I/O) so they can be unit-tested and re-run when thresholds change.
 * Output is a risk signal for human review, never a verdict: the same wrong answer can be shared by honest students
 * who were taught the same misconception, which is why the collusion score is a probability, not just a count.
 */

export interface AnswerRow {
  questionId: string;
  /** Selected option labels (MCQ). Labels identify an option across shuffled papers. */
  labels: string[];
  numericValue: number | null;
  isCorrect: boolean | null;
  timeSpentSec: number;
  changeCount: number;
}

export interface AttemptRow {
  attemptId: string;
  userId: string;
  answers: AnswerRow[];
}

export interface QuestionMeta {
  /** Number of options for MCQ (used for the by-chance match probability). */
  optionCount: number;
  type: 'MCQ_SINGLE' | 'MCQ_MULTI' | 'NUMERIC';
}

export interface CollusionFinding {
  a: string;
  b: string;
  userA: string;
  userB: string;
  sharedWrong: number;
  bothWrong: number;
  ratio: number;
  /** Probability that two independent guessers would share this many identical wrong answers. */
  pValue: number;
}

const key = (a: AnswerRow) => `${a.questionId}|${[...a.labels].sort().join(',')}`;

/** P(X >= k) where X is a sum of independent Bernoulli(p_i): exact Poisson-binomial tail by DP. */
export function poissonBinomialTail(ps: number[], k: number): number {
  if (k <= 0) return 1;
  if (k > ps.length) return 0;
  let dist = [1];
  for (const p of ps) {
    const next = new Array<number>(dist.length + 1).fill(0);
    for (let i = 0; i < dist.length; i++) {
      next[i] += dist[i] * (1 - p);
      next[i + 1] += dist[i] * p;
    }
    dist = next;
  }
  let tail = 0;
  for (let i = k; i < dist.length; i++) tail += dist[i];
  return Math.min(1, Math.max(0, tail));
}

/**
 * Pairs of attempts sharing many identical WRONG answers. Candidate pairs come from an inverted index on
 * (question, wrong answer), so cost scales with shared answers, not with cohort size squared.
 */
export function findCollusion(rows: AttemptRow[], meta: Map<string, QuestionMeta>, opts: { minShared: number; minRatio: number; maxPValue: number }): CollusionFinding[] {
  const wrongByAttempt = new Map<string, Map<string, AnswerRow>>();
  const index = new Map<string, string[]>();
  for (const r of rows) {
    const wrong = new Map<string, AnswerRow>();
    for (const a of r.answers) {
      if (a.isCorrect !== false) continue;
      const m = meta.get(a.questionId);
      if (!m || m.type === 'NUMERIC' || !a.labels.length) continue;
      wrong.set(a.questionId, a);
      const k = key(a);
      const list = index.get(k);
      if (list) list.push(r.attemptId);
      else index.set(k, [r.attemptId]);
    }
    wrongByAttempt.set(r.attemptId, wrong);
  }
  const shared = new Map<string, number>();
  for (const list of index.values()) {
    if (list.length < 2 || list.length > 400) continue; // a "wrong answer" nearly everyone gave is a bad question, not collusion
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const pair = list[i] < list[j] ? `${list[i]}|${list[j]}` : `${list[j]}|${list[i]}`;
      shared.set(pair, (shared.get(pair) ?? 0) + 1);
    }
  }
  const users = new Map(rows.map((r) => [r.attemptId, r.userId]));
  const out: CollusionFinding[] = [];
  for (const [pair, sharedWrong] of shared) {
    if (sharedWrong < opts.minShared) continue;
    const [a, b] = pair.split('|');
    const wa = wrongByAttempt.get(a)!;
    const wb = wrongByAttempt.get(b)!;
    const both: number[] = [];
    for (const qid of wa.keys()) {
      if (!wb.has(qid)) continue;
      const m = meta.get(qid)!;
      // Two wrong guessers on a k-option single answer agree with probability 1/(k-1); for multi-select agreement is rarer, so this is conservative.
      both.push(1 / Math.max(2, m.optionCount - 1));
    }
    const ratio = sharedWrong / Math.max(1, Math.min(wa.size, wb.size));
    const pValue = poissonBinomialTail(both, sharedWrong);
    if (ratio >= opts.minRatio && pValue <= opts.maxPValue && users.get(a) !== users.get(b)) {
      out.push({ a, b, userA: users.get(a)!, userB: users.get(b)!, sharedWrong, bothWrong: both.length, ratio: Math.round(ratio * 100) / 100, pValue });
    }
  }
  return out.sort((x, y) => x.pValue - y.pValue);
}

export interface TimingFinding {
  type: 'ANSWER_SPEED' | 'ANSWER_TIMING';
  confidence: number;
  reasons: string[];
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/**
 * Per-attempt timing anomalies.
 *  - ANSWER_SPEED: many answers faster than a person can read the question, and they are mostly right.
 *  - ANSWER_TIMING: near-constant time per question (scripted/relayed answers) or a large share of hard questions
 *    (cohort correct-rate < 25%) answered correctly within seconds.
 */
export function timingAnomalies(attempt: AttemptRow, cohortCorrectRate: Map<string, number>, opts: { minSecondsPerAnswer: number }): TimingFinding[] {
  const answered = attempt.answers.filter((a) => a.isCorrect !== null);
  const out: TimingFinding[] = [];
  if (answered.length < 10) return out; // too little data to say anything
  const fast = answered.filter((a) => a.timeSpentSec < opts.minSecondsPerAnswer);
  const fastShare = fast.length / answered.length;
  const fastAccuracy = fast.length ? fast.filter((a) => a.isCorrect).length / fast.length : 0;
  if (fastShare >= 0.5 && fastAccuracy >= 0.7) {
    out.push({ type: 'ANSWER_SPEED', confidence: Math.min(1, fastShare), reasons: [`${Math.round(fastShare * 100)}% of answers under ${opts.minSecondsPerAnswer}s, ${Math.round(fastAccuracy * 100)}% of those correct`] });
  }
  const times = answered.map((a) => a.timeSpentSec);
  const m = mean(times);
  if (answered.length >= 15 && m >= 1) {
    const sd = Math.sqrt(mean(times.map((t) => (t - m) ** 2)));
    if (sd / m < 0.15) out.push({ type: 'ANSWER_TIMING', confidence: 0.6, reasons: [`near-constant time per question (mean ${m.toFixed(1)}s, spread ${(100 * sd / m).toFixed(0)}%)`] });
  }
  const hard = answered.filter((a) => (cohortCorrectRate.get(a.questionId) ?? 1) < 0.25);
  const hardFastRight = hard.filter((a) => a.isCorrect && a.timeSpentSec <= 3);
  if (hard.length >= 5 && hardFastRight.length >= 4 && hardFastRight.length / hard.length >= 0.6) {
    out.push({ type: 'ANSWER_TIMING', confidence: 0.8, reasons: [`${hardFastRight.length} of ${hard.length} hard questions answered correctly within 3s`] });
  }
  return out;
}
