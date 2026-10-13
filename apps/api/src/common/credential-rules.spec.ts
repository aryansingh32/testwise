import { adminCreateSchema, loginSchema, registerSchema, utf8ByteLength } from '@testwise/shared';

const base = { email: 'a@example.com', displayName: 'Test User' };
describe('utf8ByteLength', () => {
  it('matches Buffer for ascii, 2/3-byte, and astral characters', () => {
    for (const s of ['', 'abc', 'é', 'आर्यन', '😀', 'a😀é中', '\u0000']) expect(utf8ByteLength(s)).toBe(Buffer.byteLength(s, 'utf8'));
  });
});
describe('credential rules', () => {
  it('rejects passwords over 72 bytes (bcrypt truncation) even when under 128 characters', () => {
    expect(registerSchema.safeParse({ ...base, password: 'a'.repeat(72) }).success).toBe(true);
    expect(registerSchema.safeParse({ ...base, password: 'a'.repeat(73) }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: 'é'.repeat(37) }).success).toBe(false); // 74 bytes
    expect(adminCreateSchema.safeParse({ email: 'a@example.com', name: 'Admin', role: 'SUPPORT', password: 'x'.repeat(73) }).success).toBe(false);
  });
  it('still lets existing users with long passwords attempt to sign in', () => {
    expect(loginSchema.safeParse({ email: 'a@example.com', password: 'x'.repeat(100) }).success).toBe(true);
  });
  it('caps email length at 254 and normalises case/whitespace', () => {
    expect(registerSchema.safeParse({ ...base, email: 'x'.repeat(250) + '@example.com', password: 'Str0ng!Pass' }).success).toBe(false);
    expect(registerSchema.parse({ ...base, email: '  Mixed@Example.COM ', password: 'Str0ng!Pass' }).email).toBe('mixed@example.com');
  });
});
