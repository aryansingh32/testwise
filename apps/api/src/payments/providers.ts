import { createHmac, timingSafeEqual } from 'crypto';

export type ProviderName = 'MOCK' | 'RAZORPAY' | 'PAYTM';

export interface CreateOrderResult {
  providerOrderId: string;
  /** Hosted payment page, when the provider uses one (Razorpay Payment Links). */
  checkoutUrl: string | null;
  keyId: string | null;
}

/** Normalised webhook outcome every provider maps into. */
export interface WebhookOutcome {
  eventId: string;
  type: 'PAYMENT_CAPTURED' | 'PAYMENT_FAILED' | 'REFUND_PROCESSED' | 'IGNORED';
  providerOrderId: string | null;
  providerPaymentId: string | null;
  amountPaise: number | null;
  failureReason?: string;
}

export interface PaymentProvider {
  name: ProviderName;
  isConfigured(): boolean;
  createOrder(input: { receiptNo: string; amountPaise: number; description: string; customer: { name: string; email: string | null } }): Promise<CreateOrderResult>;
  verifySignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean;
  parseWebhook(body: unknown): WebhookOutcome;
  refund(input: { providerPaymentId: string; amountPaise: number; receiptNo: string }): Promise<{ providerRefundId: string }>;
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const hmacHex = (secret: string, body: Buffer | string) => createHmac('sha256', secret).update(body).digest('hex');

/**
 * Development gateway. Behaves like a real one: orders, HMAC-signed webhooks
 * (sent by the API to itself), refunds. Never moves money.
 */
export class MockProvider implements PaymentProvider {
  name = 'MOCK' as const;
  constructor(private readonly secret: string) {}
  isConfigured() {
    return true;
  }
  async createOrder(input: { receiptNo: string }) {
    return { providerOrderId: `mock_order_${input.receiptNo}`, checkoutUrl: null, keyId: null };
  }
  sign(body: string) {
    return hmacHex(this.secret, body);
  }
  verifySignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    const sig = headers['x-mock-signature'];
    return typeof sig === 'string' && safeEqual(sig, hmacHex(this.secret, rawBody));
  }
  parseWebhook(body: unknown): WebhookOutcome {
    const b = body as { id: string; event: string; orderId: string; paymentId: string; amountPaise: number; reason?: string };
    const type = b.event === 'payment.captured' ? 'PAYMENT_CAPTURED' : b.event === 'payment.failed' ? 'PAYMENT_FAILED' : b.event === 'refund.processed' ? 'REFUND_PROCESSED' : 'IGNORED';
    return { eventId: b.id, type, providerOrderId: b.orderId, providerPaymentId: b.paymentId, amountPaise: b.amountPaise, failureReason: b.reason };
  }
  async refund(input: { receiptNo: string }) {
    return { providerRefundId: `mock_refund_${input.receiptNo}_${Date.now()}` };
  }
}

/**
 * Razorpay via Payment Links (hosted checkout, works without a native SDK).
 * Env: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET.
 * Webhook events to enable in the Razorpay dashboard: payment_link.paid, payment.failed, refund.processed.
 */
export class RazorpayProvider implements PaymentProvider {
  name = 'RAZORPAY' as const;
  private readonly keyId = process.env.RAZORPAY_KEY_ID ?? '';
  private readonly keySecret = process.env.RAZORPAY_KEY_SECRET ?? '';
  private readonly webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET ?? '';

  isConfigured() {
    return !!(this.keyId && this.keySecret && this.webhookSecret);
  }

  private async call<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`https://api.razorpay.com/v1${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}` },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as T & { error?: { description?: string } };
    if (!res.ok) throw new Error(`Razorpay: ${json.error?.description ?? res.statusText}`);
    return json;
  }

  async createOrder(input: { receiptNo: string; amountPaise: number; description: string; customer: { name: string; email: string | null } }) {
    const link = await this.call<{ id: string; short_url: string }>('/payment_links', {
      amount: input.amountPaise,
      currency: 'INR',
      reference_id: input.receiptNo,
      description: input.description.slice(0, 2048),
      customer: { name: input.customer.name, ...(input.customer.email && { email: input.customer.email }) },
      notify: { sms: false, email: false },
      expire_by: Math.floor(Date.now() / 1000) + 30 * 60,
      notes: { receipt: input.receiptNo },
    });
    return { providerOrderId: link.id, checkoutUrl: link.short_url, keyId: this.keyId };
  }

  verifySignature(rawBody: Buffer, headers: Record<string, string | string[] | undefined>) {
    const sig = headers['x-razorpay-signature'];
    return typeof sig === 'string' && !!this.webhookSecret && safeEqual(sig, hmacHex(this.webhookSecret, rawBody));
  }

  parseWebhook(body: unknown, eventIdHeader?: string): WebhookOutcome {
    const b = body as {
      event: string;
      created_at: number;
      payload: {
        payment_link?: { entity: { id: string } };
        payment?: { entity: { id: string; amount: number; error_description?: string; notes?: { receipt?: string } } };
        refund?: { entity: { id: string; payment_id: string; amount: number } };
      };
    };
    const payment = b.payload.payment?.entity;
    const eventId = eventIdHeader ?? `${b.event}:${payment?.id ?? b.payload.refund?.entity.id}:${b.created_at}`;
    if (b.event === 'payment_link.paid') {
      return { eventId, type: 'PAYMENT_CAPTURED', providerOrderId: b.payload.payment_link?.entity.id ?? null, providerPaymentId: payment?.id ?? null, amountPaise: payment?.amount ?? null };
    }
    if (b.event === 'payment.failed') {
      return { eventId, type: 'PAYMENT_FAILED', providerOrderId: null, providerPaymentId: payment?.id ?? null, amountPaise: payment?.amount ?? null, failureReason: payment?.error_description };
    }
    if (b.event === 'refund.processed') {
      return { eventId, type: 'REFUND_PROCESSED', providerOrderId: null, providerPaymentId: b.payload.refund?.entity.payment_id ?? null, amountPaise: b.payload.refund?.entity.amount ?? null };
    }
    return { eventId, type: 'IGNORED', providerOrderId: null, providerPaymentId: null, amountPaise: null };
  }

  async refund(input: { providerPaymentId: string; amountPaise: number; receiptNo: string }) {
    const r = await this.call<{ id: string }>(`/payments/${input.providerPaymentId}/refund`, { amount: input.amountPaise, notes: { receipt: input.receiptNo } });
    return { providerRefundId: r.id };
  }
}

/** Paytm adapter is not implemented yet; selecting it in admin is blocked until it is. */
export class PaytmProvider implements PaymentProvider {
  name = 'PAYTM' as const;
  isConfigured() {
    return false;
  }
  createOrder(): Promise<CreateOrderResult> {
    throw new Error('Paytm integration is not available yet');
  }
  verifySignature() {
    return false;
  }
  parseWebhook(): WebhookOutcome {
    throw new Error('Paytm integration is not available yet');
  }
  refund(): Promise<{ providerRefundId: string }> {
    throw new Error('Paytm integration is not available yet');
  }
}
