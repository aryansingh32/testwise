/** Hard ceiling so a hostile `?page=` can never become a huge OFFSET (and `1e400` / `NaN` / negatives fall back to safe values). */
const MAX_PAGE = 100_000;

function int(value: unknown, fallback: number): number {
  if (typeof value === 'string' && value.trim() === '') return fallback; // `?pageSize=` is "not given", not 0
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  const t = Math.trunc(n);
  return Number.isFinite(t) && t !== 0 ? t : fallback;
}

/** Parse `page` / `pageSize` query values into safe, bounded integers. */
export function parsePaging(page?: unknown, pageSize?: unknown, opts: { defaultSize?: number; maxSize?: number } = {}) {
  const { defaultSize = 20, maxSize = 100 } = opts;
  const p = Math.min(MAX_PAGE, Math.max(1, int(page, 1)));
  const s = Math.min(maxSize, Math.max(1, int(pageSize, defaultSize)));
  return { page: p, pageSize: s, skip: (p - 1) * s, take: s };
}
