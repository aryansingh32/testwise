import { ageOn } from '../auth/user-mapper';
import { istDateKey, istDayStart } from './engagement.services';

const utc = (iso: string) => new Date(iso);

describe('IST day boundaries', () => {
  it('rolls the product day at 18:30 UTC (midnight IST), not at UTC midnight', () => {
    expect(istDateKey(utc('2026-10-12T18:29:59.999Z'))).toBe('2026-10-12');
    expect(istDateKey(utc('2026-10-12T18:30:00.000Z'))).toBe('2026-10-13');
    expect(istDateKey(utc('2026-10-12T23:59:59Z'))).toBe('2026-10-13');
    expect(istDateKey(utc('2026-10-13T00:00:00Z'))).toBe('2026-10-13');
  });
  it('istDayStart is the instant IST midnight begins', () => {
    expect(istDayStart(utc('2026-10-12T10:00:00Z')).toISOString()).toBe('2026-10-11T18:30:00.000Z');
    expect(istDayStart(utc('2026-10-12T18:30:00Z')).toISOString()).toBe('2026-10-12T18:30:00.000Z');
  });
  it('handles month, year and leap-day rollover', () => {
    expect(istDateKey(utc('2026-12-31T18:30:00Z'))).toBe('2027-01-01');
    expect(istDateKey(utc('2028-02-28T18:30:00Z'))).toBe('2028-02-29');
    expect(istDateKey(utc('2027-02-28T18:30:00Z'))).toBe('2027-03-01');
  });
});

describe('ageOn (IST calendar date)', () => {
  const dob = (d: string) => new Date(`${d}T00:00:00.000Z`); // @db.Date values are UTC midnight
  it('turns 18 at the start of the birthday in India, not 5.5 hours later', () => {
    expect(ageOn(dob('2008-10-13'), utc('2026-10-12T18:29:00Z'))).toBe(17);
    expect(ageOn(dob('2008-10-13'), utc('2026-10-12T18:30:00Z'))).toBe(18);
  });
  it('counts a Feb-29 birthday on Mar 1 in non-leap years and on Feb 29 in leap years', () => {
    expect(ageOn(dob('2008-02-29'), utc('2026-02-27T12:00:00Z'))).toBe(17);
    expect(ageOn(dob('2008-02-29'), utc('2026-03-01T12:00:00Z'))).toBe(18);
    expect(ageOn(dob('2008-02-29'), utc('2028-02-29T12:00:00Z'))).toBe(20);
  });
  it('is 0 on the day of birth and never negative for a same-year birth', () => {
    expect(ageOn(dob('2026-10-12'), utc('2026-10-12T12:00:00Z'))).toBe(0);
  });
});
