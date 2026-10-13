import { Ionicons } from '@expo/vector-icons';
import type { RedemptionDto } from '@testwise/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Header } from '../../components/Header';
import { AppText, Button, Card, ErrorState, Loading, Screen, StateView } from '../../components/ui';
import { fmtCoins, STATUS_COLOR } from '../../components/Wallet';
import { api, ApiError } from '../../lib/api';
import { formatDateTime, useLocalized } from '../../lib/format';
import { useSession } from '../../lib/session';
import { palette, radius } from '../../theme/tokens';

export default function Redemptions() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['redemptions'], queryFn: () => api<RedemptionDto[]>('/v1/wallet/redemptions') });
  return (
    <Screen>
      <Header title={t('wallet.myRewards')} fallback="/wallet" />
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
        <FlatList
          data={q.data}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: 20, paddingTop: 4, gap: 12, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={palette.amber} />}
          renderItem={({ item }) => <RedemptionCard r={item} />}
          ListEmptyComponent={<StateView icon="bag-handle-outline" title={t('wallet.noRedemptions')} />}
        />
      )}
    </Screen>
  );
}

function RedemptionCard({ r }: { r: RedemptionDto }) {
  const { t } = useTranslation();
  const L = useLocalized();
  const { language } = useSession();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function cancel() {
    setBusy(true);
    try {
      await api(`/v1/wallet/redemptions/${r.id}/cancel`, { method: 'POST' });
      void qc.invalidateQueries({ queryKey: ['redemptions'] });
      void qc.invalidateQueries({ queryKey: ['wallet'] });
      void qc.invalidateQueries({ queryKey: ['wallet-txns'] });
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <AppText weight="bold" size={15} numberOfLines={1}>{L(r.reward.titleEn, r.reward.titleHi)}{r.variant ? ` · ${r.variant}` : ''}</AppText>
          <AppText size={12} muted>{fmtCoins(r.coins)} · {formatDateTime(r.createdAt, language)}</AppText>
        </View>
        <View style={[styles.status, { backgroundColor: STATUS_COLOR[r.status] + '1A' }]}>
          <AppText weight="bold" size={11} color={STATUS_COLOR[r.status]}>{t(`wallet.status.${r.status}`)}</AppText>
        </View>
      </View>

      {r.voucherCode && (
        <Pressable onPress={() => copy(`${r.voucherCode}${r.voucherPin ? ` PIN ${r.voucherPin}` : ''}`)} style={styles.code} accessibilityRole="button" accessibilityLabel={t('wallet.copyCode')}>
          <View style={{ flex: 1 }}>
            <AppText size={11} muted>{t('wallet.voucherCode')}</AppText>
            <AppText weight="extrabold" size={17} selectable style={{ letterSpacing: 1 }}>{r.voucherCode}</AppText>
            {r.voucherPin && <AppText size={12} selectable>PIN {r.voucherPin}</AppText>}
          </View>
          <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={20} color={palette.amberDark} />
        </Pressable>
      )}
      {r.upiVpa && <AppText size={13} muted>{t('wallet.paidTo', { vpa: r.upiVpa })}{r.payoutRef ? ` · ${t('wallet.utr', { ref: r.payoutRef })}` : ''}</AppText>}
      {r.trackingNo && <AppText size={13} muted>{t('wallet.shipped', { carrier: r.carrier ?? '', no: r.trackingNo })}</AppText>}
      {r.shippingAddress && r.status !== 'FULFILLED' && <AppText size={12} muted>{r.shippingAddress.name}, {r.shippingAddress.city} {r.shippingAddress.pincode}</AppText>}
      {r.rejectReason && r.status !== 'CANCELLED' && <AppText size={13} color={palette.red}>{r.rejectReason} · {t('wallet.coinsReturned')}</AppText>}
      {r.status === 'PENDING' && <Button title={t('wallet.cancelRequest')} variant="ghost" size="md" onPress={cancel} loading={busy} />}
    </Card>
  );
}

const styles = StyleSheet.create({
  status: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  code: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.md, backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A', borderStyle: 'dashed' },
});
