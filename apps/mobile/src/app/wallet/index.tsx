import { Ionicons } from '@expo/vector-icons';
import type { WalletTxnDto } from '@testwise/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Header } from '../../components/Header';
import { AppText, Button, Card, ErrorState, Loading, Screen, StateView } from '../../components/ui';
import { BalanceCard, TxnRow, useWallet } from '../../components/Wallet';
import { api } from '../../lib/api';
import { palette, radius } from '../../theme/tokens';

export default function WalletHome() {
  const { t } = useTranslation();
  const w = useWallet();
  const txns = useInfiniteQuery({
    queryKey: ['wallet-txns'],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<WalletTxnDto[]>(`/v1/wallet/transactions${pageParam ? `?before=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (last) => (last.length === 50 ? last[last.length - 1].createdAt : undefined),
    enabled: !!w.data,
  });
  const refresh = () => {
    void w.refetch();
    void txns.refetch();
  };

  if (w.isLoading) return <Screen><Header title={t('wallet.title')} fallback="/profile" /><Loading /></Screen>;
  if (w.error || !w.data) {
    return (
      <Screen>
        <Header title={t('wallet.title')} fallback="/profile" />
        {(w.error as { status?: number } | null)?.status === 403 ? <StateView icon="wallet-outline" title={t('wallet.off')} /> : <ErrorState error={w.error} onRetry={w.refetch} />}
      </Screen>
    );
  }
  const { wallet, settings } = w.data;
  const rows = txns.data?.pages.flat() ?? [];

  return (
    <Screen>
      <Header title={t('wallet.title')} fallback="/profile" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 4, gap: 16, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={w.isRefetching} onRefresh={refresh} tintColor={palette.amber} />}>
        {wallet.frozen && (
          <View style={styles.frozen}>
            <Ionicons name="lock-closed" size={18} color={palette.red} />
            <AppText size={13} color={palette.red} style={{ flex: 1 }}>{t('wallet.frozen')}{wallet.frozenReason ? ` ${wallet.frozenReason}` : ''}</AppText>
          </View>
        )}
        <BalanceCard wallet={wallet} />
        <View style={styles.actions}>
          {settings.topUpEnabled && <Action icon="add-circle-outline" label={t('wallet.topUp')} onPress={() => router.push('/wallet/topup')} disabled={wallet.frozen} />}
          {settings.redemptionsEnabled && <Action icon="gift-outline" label={t('wallet.rewards')} onPress={() => router.push('/wallet/rewards')} disabled={wallet.frozen} />}
          <Action icon="bag-check-outline" label={t('wallet.myRewards')} onPress={() => router.push('/wallet/redemptions')} />
        </View>

        <Card>
          <AppText weight="bold" size={16} style={{ marginBottom: 4 }}>{t('wallet.history')}</AppText>
          {txns.isLoading ? <Loading /> : !rows.length ? (
            <StateView icon="swap-vertical-outline" title={t('wallet.noHistory')} />
          ) : (
            <View>
              {rows.map((x) => <TxnRow key={x.id} txn={x} />)}
              {txns.hasNextPage && <Button title={t('wallet.more')} variant="ghost" onPress={() => void txns.fetchNextPage()} loading={txns.isFetchingNextPage} />}
            </View>
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

function Action({ icon, label, onPress, disabled }: { icon: ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.action, disabled && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.actionIcon}><Ionicons name={icon} size={22} color={palette.amberDark} /></View>
      <AppText weight="bold" size={12} style={{ textAlign: 'center' }}>{label}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 12 },
  action: { flex: 1, alignItems: 'center', gap: 8, paddingVertical: 14, borderRadius: radius.md, backgroundColor: '#FFFBEB' },
  actionIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FEF3C7', alignItems: 'center', justifyContent: 'center' },
  frozen: { flexDirection: 'row', gap: 8, alignItems: 'center', padding: 12, borderRadius: 12, backgroundColor: '#FEF2F2' },
});
