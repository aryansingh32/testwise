import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { PaymentsService } from './payments.service';

const SECRET = 'test-mock-secret';

function build() {
  process.env.MOCK_WEBHOOK_SECRET = SECRET;
  const prisma = { paymentEvent: { create: jest.fn().mockResolvedValue({ id: 'evt' }), update: jest.fn() }, order: { findUnique: jest.fn().mockResolvedValue(null) } };
  const svc = new PaymentsService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  return { svc, prisma };
}
const sign = (body: Buffer) => createHmac('sha256', SECRET).update(body).digest('hex');

describe('payment webhooks', () => {
  it('rejects an unsigned webhook without persisting it (cannot shadow a genuine event id)', async () => {
    const { svc, prisma } = build();
    const body = Buffer.from(JSON.stringify({ id: 'evt_1', event: 'payment.captured', orderId: 'o', paymentId: 'p', amountPaise: 100 }));
    await expect(svc.handleWebhook('mock', body, {})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.handleWebhook('mock', body, { 'x-mock-signature': 'deadbeef' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.paymentEvent.create).not.toHaveBeenCalled();
  });

  it('answers 400 (not a database error) when a signed webhook has no event id', async () => {
    const { svc, prisma } = build();
    const body = Buffer.from(JSON.stringify({ type: 'payment.succeeded', orderId: 'x' }));
    await expect(svc.handleWebhook('mock', body, { 'x-mock-signature': sign(body) })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.paymentEvent.create).not.toHaveBeenCalled();
  });

  it('accepts and records a correctly signed event', async () => {
    const { svc, prisma } = build();
    const body = Buffer.from(JSON.stringify({ id: 'evt_2', event: 'something.else' }));
    await expect(svc.handleWebhook('mock', body, { 'x-mock-signature': sign(body) })).resolves.toMatchObject({ ok: true });
    expect(prisma.paymentEvent.create).toHaveBeenCalledTimes(1);
  });
});
