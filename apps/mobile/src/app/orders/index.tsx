import { Ionicons } from '@expo/vector-icons';
import { formatRupees, type OrderDto } from '@testwise/shared';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { Header } from '../../components/Header';
import { AppText, Card, ErrorState, Loading, Screen, StateView } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useSession } from '../../lib/session';
import { palette } from '../../theme/tokens';

const orderColor = (s: string) => (s === 'PAID' ? palette.green : s === 'REFUNDED' || s === 'REFUND_PENDING' ? palette.blue : s === 'CREATED' ? palette.amber : palette.red);

export default function Orders() {
  const { t } = useTranslation();
  const { language } = useSession();
  const { data, error, isLoading, refetch, isRefetching } = useQuery({ queryKey: ['orders'], queryFn: () => api<OrderDto[]>('/v1/me/orders') });
  return (
    <Screen>
      <Header title={t('orders.title')} fallback="/profile" />
      {isLoading ? <Loading /> : error ? <ErrorState error={error} onRetry={refetch} /> : (
        <FlatList
          data={data}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ padding: 20, gap: 12, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={palette.amber} />}
          renderItem={({ item: o }) => (
            <Pressable onPress={() => router.push({ pathname: '/orders/[id]', params: { id: o.id } })}>
              <Card style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                <Ionicons name="receipt-outline" size={22} color={palette.amber} />
                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={14} numberOfLines={1}>{o.descriptionEn}</AppText>
                  <AppText size={12} muted>{o.receiptNo} · {formatDateTime(o.createdAt, language)}</AppText>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <AppText weight="extrabold" size={15}>{formatRupees(o.amountPaise)}</AppText>
                  <AppText weight="bold" size={11} color={orderColor(o.status)}>{t(`orders.status.${o.status}`)}</AppText>
                </View>
              </Card>
            </Pressable>
          )}
          ListEmptyComponent={<StateView icon="receipt-outline" title={t('orders.empty')} />}
        />
      )}
    </Screen>
  );
}
