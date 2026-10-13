import { parsePaging } from './pagination';

describe('parsePaging', () => {
  it('uses defaults for missing / garbage values', () => {
    for (const bad of [undefined, '', 'abc', 'NaN', null, {}, ['1']]) {
      expect(parsePaging(bad, bad)).toEqual({ page: 1, pageSize: 20, skip: 0, take: 20 });
    }
  });
  it('clamps negatives, zero, fractions and absurd sizes', () => {
    expect(parsePaging('-5', '-5')).toMatchObject({ page: 1, pageSize: 1 });
    expect(parsePaging('0', '0')).toMatchObject({ page: 1, pageSize: 20 });
    expect(parsePaging('2.9', '10.7')).toMatchObject({ page: 2, pageSize: 10, skip: 10 });
    expect(parsePaging('1', '999999999')).toMatchObject({ pageSize: 100 });
  });
  it('treats Infinity / overflow as invalid and caps the page so OFFSET stays bounded', () => {
    expect(parsePaging('1e400', '1e400')).toMatchObject({ page: 1, pageSize: 20 });
    expect(parsePaging('99999999999', '100')).toMatchObject({ page: 100_000, skip: 99_999 * 100 });
  });
  it('honours a custom default and max size', () => {
    expect(parsePaging(undefined, undefined, { defaultSize: 25 })).toMatchObject({ pageSize: 25 });
    expect(parsePaging('1', '500', { maxSize: 50 })).toMatchObject({ pageSize: 50 });
  });
});
