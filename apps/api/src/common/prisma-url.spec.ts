import { withTimeoutDefaults } from './prisma.service';

describe('withTimeoutDefaults', () => {
  it('adds bounded connect/pool timeouts when absent', () => {
    const u = new URL(withTimeoutDefaults('postgresql://u:p@localhost:5433/db')!);
    expect(u.searchParams.get('connect_timeout')).toBe('3');
    expect(u.searchParams.get('pool_timeout')).toBe('8');
  });
  it('never overrides values the operator set explicitly', () => {
    const u = new URL(withTimeoutDefaults('postgresql://u:p@h/db?connection_limit=20&pool_timeout=30&connect_timeout=10')!);
    expect(u.searchParams.get('pool_timeout')).toBe('30');
    expect(u.searchParams.get('connect_timeout')).toBe('10');
    expect(u.searchParams.get('connection_limit')).toBe('20');
  });
  it('passes through undefined and malformed URLs untouched', () => {
    expect(withTimeoutDefaults(undefined)).toBeUndefined();
    expect(withTimeoutDefaults('not a url')).toBe('not a url');
  });
});
