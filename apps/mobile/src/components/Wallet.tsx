import { Ionicons } from '@expo/vector-icons';
import { paiseToCoins, type RedemptionStatus, RewardDto, WalletDto, WalletTxnDto } from '@testwise/shared';
import { useQuery } from '@tanstack/react-query';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { api, ApiError } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { useSession } from '../lib/session';
import { palette, radius } from '../theme/tokens';
import { AppText } from './ui';

export interface WalletSettings {
  enabled: boolean;
  coinNameEn: string;
  coinNameHi: string;
  coinValuePaise: number;
  topUpEnabled: boolean;
  redemptionsEnabled: boolean;
  upiPayoutsEnabled: boolean;
}

export function useWallet() {
  return useQuery({ queryKey: ['wallet'], queryFn: () => api<{ wallet: WalletDto; settings: WalletSettings }>('/v1/wallet') });
}

export function useRewards() {
  return useQuery({ queryKey: ['rewards'], queryFn: () => api<RewardDto[]>('/v1/wallet/rewards') });
}

/** Coin name in the student's language, from admin settings. */
export function useCoinName() {
  const { config, language } = useSession();
  const s = config?.['wallet.settings'];
  return (language === 'HI' ? s?.coinNameHi : s?.coinNameEn) ?? 'Coins';
}

export const fmtCoins = (n: number) => n.toLocaleString('en-IN');

/** Error alert for a coin purchase. A short balance offers a straight path to the top-up screen. */
export function usePurchaseError() {
  const { t } = useTranslation();
  const coinName = useCoinName();
  return (e: unknown) => {
    const msg = e instanceof ApiError ? (e.status === 0 ? t('common.offline') : e.message) : String(e);
    if (e instanceof ApiError && /not enough coins/i.test(e.message)) {
      Alert.alert(t('common.error'), t('wallet.notEnoughToBuy', { coin: coinName }), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('wallet.topUp'), onPress: () => router.push('/wallet/topup') },
      ]);
    } else Alert.alert(t('common.error'), msg);
  };
}

/** Formats a rupee-stored price (paise) as coins, e.g. "4,990 Coins". Prices are shown in coins only. */
export function useCoinPrice() {
  const { config } = useSession();
  const coinName = useCoinName();
  const cv = config?.['wallet.settings']?.coinValuePaise ?? 10;
  return (paise: number) => `${fmtCoins(paiseToCoins(paise, cv))} ${coinName}`;
}

export const STATUS_COLOR: Record<RedemptionStatus, string> = {
  PENDING: palette.amber,
  APPROVED: palette.blue,
  FULFILLED: palette.green,
  REJECTED: palette.red,
  FAILED: palette.red,
  CANCELLED: '#9CA3AF',
};

export function CoinIcon({ size = 18 }: { size?: number }) {
  return (
    <View style={[styles.coin, { width: size, height: size, borderRadius: size / 2 }]}>
      <Ionicons name="star" size={size * 0.55} color="#92400E" />
    </View>
  );
}

/** Dark balance card with the purchased / earned / on-hold split. */
export function BalanceCard({ wallet }: { wallet: WalletDto }) {
  const { t } = useTranslation();
  const coinName = useCoinName();
  return (
    <View style={styles.balance}>
      <View style={styles.balanceGlow} />
      <AppText weight="semibold" size={13} color="rgba(255,255,255,0.7)">{t('wallet.available', { coin: coinName })}</AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 }}>
        <CoinIcon size={30} />
        <AppText weight="extrabold" size={36} color="#FFFFFF">{fmtCoins(wallet.available)}</AppText>
      </View>
      <View style={styles.split}>
        <Split label={t('wallet.purchased')} value={wallet.purchased} />
        <Split label={t('wallet.earned')} value={wallet.earned} />
        <Split label={t('wallet.onHold')} value={wallet.held} />
      </View>
      <AppText size={11} color="rgba(255,255,255,0.55)" style={{ marginTop: 10 }}>{t('wallet.splitHint')}</AppText>
    </View>
  );
}

function Split({ label, value }: { label: string; value: number }) {
  return (
    <View style={{ flex: 1 }}>
      <AppText size={11} color="rgba(255,255,255,0.6)">{label}</AppText>
      <AppText weight="extrabold" size={16} color="#FFFFFF">{fmtCoins(value)}</AppText>
    </View>
  );
}

const TXN_ICON: Record<WalletTxnDto['type'], ComponentProps<typeof Ionicons>['name']> = {
  TOPUP: 'add-circle',
  TOPUP_REFUND: 'return-down-back',
  EARN_PRIZE: 'trophy',
  EARN_DUEL: 'flash',
  ADMIN_CREDIT: 'gift',
  ADMIN_DEBIT: 'remove-circle',
  REDEEM_HOLD: 'time',
  REDEEM_RELEASE: 'arrow-undo',
  REDEEM_SETTLE: 'bag-check',
  DUEL_ENTRY: 'flash',
  DUEL_REFUND: 'return-up-back',
  DUEL_PRIZE: 'trophy',
  GAME_REWARD: 'sparkles',
  SPEND: 'bag-handle',
  SPEND_REFUND: 'return-up-back',
};

/** One coin movement. Holds show as "on hold" rather than spent until settled. */
export function TxnRow({ txn }: { txn: WalletTxnDto }) {
  const { t } = useTranslation();
  const { language } = useSession();
  // Coins leave the balance when put on hold; settling only confirms delivery, so it shows no second deduction.
  const settled = txn.type === 'REDEEM_SETTLE';
  const amount = txn.purchasedDelta + txn.earnedDelta;
  const color = settled ? '#6B7280' : amount > 0 ? palette.green : amount < 0 ? palette.red : '#6B7280';
  return (
    <View style={styles.txn}>
      <View style={[styles.txnIcon, { backgroundColor: color + '1A' }]}>
        <Ionicons name={TXN_ICON[txn.type]} size={18} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText weight="bold" size={14} numberOfLines={1}>{t(`wallet.txn.${txn.type}`)}</AppText>
        <AppText size={12} muted numberOfLines={1}>{txn.memo} · {formatDateTime(txn.createdAt, language)}</AppText>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        {settled ? (
          <AppText weight="bold" size={13} color={color}>{t('wallet.settled')}</AppText>
        ) : (
          <AppText weight="extrabold" size={15} color={color}>{amount > 0 ? '+' : ''}{fmtCoins(amount)}</AppText>
        )}
        {txn.type === 'REDEEM_HOLD' && <AppText size={10} muted>{t('wallet.heldNote')}</AppText>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  coin: { backgroundColor: '#FCD34D', borderWidth: 2, borderColor: '#F59E0B', alignItems: 'center', justifyContent: 'center' },
  balance: { overflow: 'hidden', padding: 20, borderRadius: radius.lg, backgroundColor: '#0B1530' },
  balanceGlow: { position: 'absolute', right: -40, top: -40, width: 160, height: 160, borderRadius: 80, backgroundColor: 'rgba(245,158,11,0.18)' },
  split: { flexDirection: 'row', marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.12)' },
  txn: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  txnIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
});
