import { Ionicons } from '@expo/vector-icons';
import { formatRupees, type OrderDto } from '@testwise/shared';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, Share, View } from 'react-native';
import { Header } from '../../components/Header';
import { AppText, Button, Card, ErrorState, Loading, Screen } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useSession } from '../../lib/session';
import { palette } from '../../theme/tokens';

const color = (s: string) => (s === 'PAID' ? palette.green : s === 'REFUNDED' || s === 'REFUND_PENDING' ? palette.blue : s === 'CREATED' ? palette.amber : palette.red);

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 6 }}>
      <AppText size={13} muted>{k}</AppText>
      <AppText size={13} weight={strong ? 'extrabold' : 'semibold'} style={{ flexShrink: 1, textAlign: 'right' }}>{v}</AppText>
    </View>
  );
}

export default function OrderReceipt() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const { language } = useSession();
  const { data: o, error, isLoading, refetch } = useQuery({ queryKey: ['order', id], queryFn: () => api<OrderDto>(`/v1/me/orders/${id}`) });
  if (isLoading) return <Screen><Loading /></Screen>;
  if (error || !o) return <Screen><ErrorState error={error} onRetry={refetch} /></Screen>;
  const receiptText = [`Testwise receipt ${o.receiptNo}`, o.descriptionEn, `Amount: ${formatRupees(o.amountPaise)}`, `Status: ${o.status}`, o.paidAt ? `Paid: ${formatDateTime(o.paidAt, 'EN')}` : '', o.providerPaymentId ? `Payment ID: ${o.providerPaymentId}` : ''].filter(Boolean).join('\n');
  return (
    <Screen>
      <Header title={o.receiptNo} fallback="/orders" right={<Ionicons name="share-outline" size={22} color={palette.ink} onPress={() => Share.share({ message: receiptText })} accessibilityLabel="Share" />} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        <Card style={{ alignItems: 'center', gap: 6, paddingVertical: 24 }}>
          <Ionicons name={o.status === 'PAID' ? 'checkmark-circle' : o.status.startsWith('REFUND') ? 'return-up-back' : 'time'} size={44} color={color(o.status)} />
          <AppText weight="extrabold" size={28}>{formatRupees(o.amountPaise)}</AppText>
          <AppText weight="bold" size={13} color={color(o.status)}>{t(`orders.status.${o.status}`)}</AppText>
        </Card>
        <Card>
          <Row k="Item" v={o.descriptionEn} />
          {o.discountPaise > 0 && <Row k={`${t('checkout.discount')} (${o.couponCode})`} v={`−${formatRupees(o.discountPaise)}`} />}
          <Row k={t('checkout.payable')} v={formatRupees(o.amountPaise)} strong />
          <Row k="Receipt" v={o.receiptNo} />
          {o.paidAt && <Row k={t('orders.paidOn', { date: '' }).trim()} v={formatDateTime(o.paidAt, language)} />}
          {o.providerPaymentId && <Row k="Payment ID" v={o.providerPaymentId} />}
          <Row k="Gateway" v={o.provider} />
        </Card>
        {o.refunds.length > 0 && (
          <Card style={{ gap: 6 }}>
            <AppText weight="bold" size={15}>{t('orders.refunds')}</AppText>
            {o.refunds.map((r) => <Row key={r.id} k={`${r.reason} · ${formatDateTime(r.createdAt, language)}`} v={`${formatRupees(r.amountPaise)} · ${r.status}`} />)}
          </Card>
        )}
        <Button title={t('orders.help')} variant="secondary" icon="help-circle-outline" onPress={() => router.push({ pathname: '/support/new', params: { category: 'PAYMENT', orderId: o.id, subject: `Payment ${o.receiptNo}` } })} />
      </ScrollView>
    </Screen>
  );
}
