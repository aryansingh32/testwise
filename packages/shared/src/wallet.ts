import { z } from 'zod';

// ---------- Wallet ----------

export type RewardKind = 'MERCH' | 'VOUCHER' | 'UPI_CASH' | 'OTHER';
export type RedemptionStatus = 'PENDING' | 'APPROVED' | 'FULFILLED' | 'REJECTED' | 'CANCELLED' | 'FAILED';
export type WalletTxnType =
  | 'TOPUP'
  | 'TOPUP_REFUND'
  | 'EARN_PRIZE'
  | 'EARN_DUEL'
  | 'ADMIN_CREDIT'
  | 'ADMIN_DEBIT'
  | 'REDEEM_HOLD'
  | 'REDEEM_RELEASE'
  | 'REDEEM_SETTLE'
  | 'DUEL_ENTRY'
  | 'DUEL_REFUND'
  | 'DUEL_PRIZE'
  | 'GAME_REWARD';

export const REWARD_KIND_INFO: Record<RewardKind, { labelEn: string; labelHi: string; icon: string }> = {
  MERCH: { labelEn: 'Merchandise', labelHi: 'मर्चेंडाइज़', icon: 'shirt' },
  VOUCHER: { labelEn: 'Vouchers', labelHi: 'वाउचर', icon: 'ticket' },
  UPI_CASH: { labelEn: 'UPI payout', labelHi: 'UPI भुगतान', icon: 'cash' },
  OTHER: { labelEn: 'Other', labelHi: 'अन्य', icon: 'gift' },
};

export interface WalletDto {
  purchased: number;
  earned: number;
  held: number;
  available: number;
  /** Earned coins that can go to UPI rewards. */
  withdrawable: number;
  frozen: boolean;
  frozenReason: string | null;
  coinValuePaise: number;
}

export interface WalletTxnDto {
  id: string;
  type: WalletTxnType;
  purchasedDelta: number;
  earnedDelta: number;
  heldDelta: number;
  memo: string;
  refType: string | null;
  refId: string | null;
  createdAt: string;
}

export interface CoinPackDto {
  id: string;
  titleEn: string;
  titleHi: string | null;
  coins: number;
  bonusCoins: number;
  pricePaise: number;
  badgeEn: string | null;
  badgeHi: string | null;
  active: boolean;
  sortOrder: number;
}

export interface RewardDto {
  id: string;
  kind: RewardKind;
  titleEn: string;
  titleHi: string | null;
  descriptionEn: string | null;
  descriptionHi: string | null;
  termsEn: string | null;
  termsHi: string | null;
  imageUrl: string | null;
  brand: string | null;
  coinCost: number;
  /** Payout for UPI rewards, face value for vouchers. Platform cost for merch is admin-only. */
  valuePaise: number;
  variants: string[];
  requiresAddress: boolean;
  requiresUpi: boolean;
  allowPurchasedCoins: boolean;
  inStock: boolean;
  stockLeft: number | null;
  perUserLimit: number | null;
  active: boolean;
  sortOrder: number;
}

export interface RedemptionDto {
  id: string;
  reward: { id: string; kind: RewardKind; titleEn: string; titleHi: string | null; imageUrl: string | null };
  coins: number;
  fromPurchased: number;
  fromEarned: number;
  status: RedemptionStatus;
  variant: string | null;
  shippingAddress: ShippingAddress | null;
  upiVpa: string | null;
  voucherCode: string | null;
  voucherPin: string | null;
  payoutRef: string | null;
  carrier: string | null;
  trackingNo: string | null;
  rejectReason: string | null;
  createdAt: string;
  fulfilledAt: string | null;
}

export interface AdminRedemptionDto extends RedemptionDto {
  user: { id: string; displayName: string; email: string | null; phone: string | null };
  adminNote: string | null;
  reviewedById: string | null;
  reviewedAt: string | null;
  costPaise: number;
}

// ---------- Schemas ----------

const optText = (max: number) => z.string().trim().max(max).optional().nullable();

export const shippingAddressSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number'),
  line1: z.string().trim().min(3).max(160),
  line2: optText(160),
  city: z.string().trim().min(2).max(60),
  state: z.string().trim().min(2).max(60),
  pincode: z.string().trim().regex(/^\d{6}$/, 'Enter a 6-digit PIN code'),
});
export type ShippingAddress = z.infer<typeof shippingAddressSchema>;

export const upiVpaSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,64}$/, 'Enter a valid UPI ID, e.g. name@bank');

export const redeemSchema = z.object({
  rewardId: z.string().min(1),
  variant: z.string().trim().max(40).optional().nullable(),
  shippingAddress: shippingAddressSchema.optional().nullable(),
  upiVpa: upiVpaSchema.optional().nullable(),
  idempotencyKey: z.string().uuid(),
});
export type RedeemInput = z.infer<typeof redeemSchema>;

export const topUpSchema = z.object({ packId: z.string().min(1), idempotencyKey: z.string().uuid() });

export const coinPackSchema = z.object({
  titleEn: z.string().trim().min(1).max(60),
  titleHi: optText(60),
  coins: z.number().int().min(1).max(10_000_000),
  bonusCoins: z.number().int().min(0).max(10_000_000).default(0),
  pricePaise: z.number().int().min(100).max(10_000_000),
  badgeEn: optText(30),
  badgeHi: optText(30),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});
export type CoinPackInput = z.infer<typeof coinPackSchema>;

export const rewardSchema = z
  .object({
    kind: z.enum(['MERCH', 'VOUCHER', 'UPI_CASH', 'OTHER']),
    titleEn: z.string().trim().min(2).max(100),
    titleHi: optText(100),
    descriptionEn: optText(2000),
    descriptionHi: optText(2000),
    termsEn: optText(2000),
    termsHi: optText(2000),
    imageUrl: optText(500),
    brand: optText(60),
    coinCost: z.number().int().min(1).max(100_000_000),
    valuePaise: z.number().int().min(0).max(100_000_000).default(0),
    costPaise: z.number().int().min(0).max(100_000_000).default(0),
    variants: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    stock: z.number().int().min(0).max(10_000_000).optional().nullable(),
    perUserLimit: z.number().int().min(1).max(1000).optional().nullable(),
    requiresAddress: z.boolean().default(false),
    allowPurchasedCoins: z.boolean().default(true),
    autoApprove: z.boolean().default(false),
    active: z.boolean().default(true),
    sortOrder: z.number().int().default(0),
  })
  .superRefine((r, ctx) => {
    if (r.kind === 'UPI_CASH' && r.valuePaise < 100) ctx.addIssue({ code: 'custom', path: ['valuePaise'], message: 'UPI rewards need a payout amount of at least ₹1' });
    if (r.kind === 'UPI_CASH' && r.allowPurchasedCoins) ctx.addIssue({ code: 'custom', path: ['allowPurchasedCoins'], message: 'Purchased coins can never be cashed out to UPI' });
  });
export type RewardInput = z.infer<typeof rewardSchema>;

export const voucherCodesSchema = z.object({
  codes: z
    .array(z.object({ code: z.string().trim().min(3).max(120), pin: optText(40), expiresAt: z.string().datetime({ offset: true }).optional().nullable() }))
    .min(1)
    .max(5000),
});

export const redemptionActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('APPROVE'), note: optText(500) }),
  z.object({ action: z.literal('REJECT'), reason: z.string().trim().min(3).max(500) }),
  z.object({
    action: z.literal('FULFILL'),
    payoutRef: optText(120),
    carrier: optText(60),
    trackingNo: optText(80),
    voucherCode: optText(120),
    voucherPin: optText(40),
    note: optText(500),
  }),
  z.object({ action: z.literal('FAIL'), reason: z.string().trim().min(3).max(500) }),
]);
export type RedemptionActionInput = z.infer<typeof redemptionActionSchema>;

export const walletAdjustSchema = z.object({
  bucket: z.enum(['EARNED', 'PURCHASED']),
  amount: z.number().int().refine((n) => n !== 0, 'Amount cannot be zero').refine((n) => Math.abs(n) <= 10_000_000, 'Too large'),
  reason: z.string().trim().min(5).max(300),
  notify: z.boolean().default(true),
});
export type WalletAdjustInput = z.infer<typeof walletAdjustSchema>;

export const walletFreezeSchema = z.object({ frozen: z.boolean(), reason: z.string().trim().max(300).optional().nullable() });

export function coinsToPaise(coins: number, coinValuePaise: number) {
  return coins * coinValuePaise;
}
