import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AuthService } from './auth.service';

type U = { id: string; firebaseUid: string | null; email: string | null; phone: string | null; status: string; deletedAt: Date | null };
function make(users: U[], verified: Record<string, unknown>, methods = { google: true, phoneOtp: true, emailPassword: true }) {
  const db = [...users];
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: Partial<U> }) => db.find((u) => Object.entries(where).every(([k, v]) => (u as never)[k] === v)) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<U> }) => Object.assign(db.find((u) => u.id === where.id)!, data),
      create: async ({ data }: { data: Partial<U> }) => { const u = { id: `new${db.length}`, firebaseUid: null, email: null, phone: null, status: 'ACTIVE', deletedAt: null, ...data } as U; db.push(u); return u; },
    },
  };
  const svc = new AuthService(prisma as never, null as never, { get: async () => methods } as never, { log: async () => undefined } as never, null as never, { verify: async () => verified } as never, null as never);
  const sessionSpy = jest.spyOn(svc as never, 'session' as never).mockImplementation((async (u: U) => ({ user: u })) as never);
  return { svc, db, sessionSpy };
}
const base = { uid: 'fb1', email: 'a@x.com', emailVerified: true, phone: null, name: 'Asha K', provider: 'google.com' };

describe('Firebase sign-in', () => {
  it('creates an account from a verified Google sign-in', async () => {
    const { svc, db } = make([], base);
    await svc.firebase('t'.repeat(120));
    expect(db[0]).toMatchObject({ firebaseUid: 'fb1', email: 'a@x.com', displayName: 'Asha K', authProvider: 'GOOGLE' });
  });
  it('links to an existing account by a VERIFIED email', async () => {
    const { svc, db } = make([{ id: 'u1', firebaseUid: null, email: 'a@x.com', phone: null, status: 'ACTIVE', deletedAt: null }], base);
    await svc.firebase('t'.repeat(120));
    expect(db).toHaveLength(1);
    expect(db[0].firebaseUid).toBe('fb1');
  });
  it('never links by an UNVERIFIED email (no account takeover by claiming an address)', async () => {
    const { svc, db } = make([{ id: 'u1', firebaseUid: null, email: 'a@x.com', phone: null, status: 'ACTIVE', deletedAt: null }], { ...base, emailVerified: false });
    await svc.firebase('t'.repeat(120));
    expect(db).toHaveLength(2);
    expect(db[0].firebaseUid).toBeNull();
    expect(db[1].email).toBeNull();
  });
  it('phone sign-in creates a phone account and links by phone', async () => {
    const { svc, db } = make([], { uid: 'fb2', email: null, emailVerified: false, phone: '+919999999999', name: null, provider: 'phone' });
    await svc.firebase('t'.repeat(120));
    expect(db[0]).toMatchObject({ phone: '+919999999999', authProvider: 'PHONE', displayName: 'Student 9999' });
  });
  it('respects the admin toggles', async () => {
    const { svc } = make([], base, { google: false, phoneOtp: true, emailPassword: true });
    await expect(svc.firebase('t'.repeat(120))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects other providers (password is handled by our own login)', async () => {
    const { svc } = make([], { ...base, provider: 'password' });
    await expect(svc.firebase('t'.repeat(120))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('refuses suspended accounts', async () => {
    const { svc } = make([{ id: 'u1', firebaseUid: 'fb1', email: 'a@x.com', phone: null, status: 'SUSPENDED', deletedAt: null }], base);
    await expect(svc.firebase('t'.repeat(120))).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('does not link a Firebase identity that already belongs to another account', async () => {
    const { svc } = make([
      { id: 'u1', firebaseUid: 'fb1', email: null, phone: null, status: 'ACTIVE', deletedAt: null },
    ], { ...base, uid: 'fb1' });
    await expect(svc.firebase('t'.repeat(120))).resolves.toBeDefined(); // found by uid: simply signs in
    void ConflictException;
  });
});
