import { Ionicons } from '@expo/vector-icons';
import type { NotificationDto } from '@testwise/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Header } from '../components/Header';
import { AppText, Chip, ErrorState, Loading, Screen, StateView } from '../components/ui';
import { CATEGORY_INFO, type NotificationCategory } from '@testwise/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { api } from '../lib/api';
import { formatDateTime, useLocalized } from '../lib/format';
import { openLink } from '../lib/links';
import { useSession } from '../lib/session';
import { palette, radius } from '../theme/tokens';

export default function Notifications() {
  const { t } = useTranslation();
  const L = useLocalized();
  const { language } = useSession();
  const qc = useQueryClient();
  const [category, setCategory] = useState<string | null>(null);
  const { data: all, error, isLoading, refetch, isRefetching } = useQuery({ queryKey: ['notifications'], queryFn: () => api<NotificationDto[]>('/v1/me/notifications') });
  const data = category ? all?.filter((n) => n.category === category) : all;
  const present = [...new Set((all ?? []).map((n) => n.category).filter(Boolean))] as NotificationCategory[];

  // Opening the inbox marks everything read.
  useEffect(() => {
    if (all?.some((n) => !n.read)) {
      void api('/v1/me/notifications/read', { method: 'POST' }).then(() => void qc.invalidateQueries({ queryKey: ['home'] }));
    }
  }, [all, qc]);

  return (
    <Screen>
      <Header title={t('notifications.title')} right={<Ionicons name="options-outline" size={22} color={palette.ink} onPress={() => router.push('/notification-settings')} accessibilityLabel={t('push.settings')} />} />
      {present.length > 1 && (
        <View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 6, gap: 8 }}>
            <Chip label={t('store.all')} active={!category} onPress={() => setCategory(null)} />
            {present.map((c) => <Chip key={c} label={language === 'HI' ? CATEGORY_INFO[c].labelHi : CATEGORY_INFO[c].labelEn} active={category === c} onPress={() => setCategory(c)} />)}
          </ScrollView>
        </View>
      )}
      {isLoading ? <Loading /> : error ? <ErrorState error={error} onRetry={refetch} /> : (
        <FlatList
          data={data}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ padding: 20, gap: 10, flexGrow: 1, maxWidth: 760, width: '100%', alignSelf: 'center' }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={palette.amber} />}
          renderItem={({ item: n }) => (
            <Pressable onPress={() => openLink(n.link)} style={[styles.item, !n.read && styles.unread]}>
              <View style={[styles.dot, { backgroundColor: n.read ? 'transparent' : palette.amber }]} />
              <View style={{ flex: 1, gap: 2 }}>
                <AppText weight="bold" size={14}>{L(n.titleEn, n.titleHi)}</AppText>
                <AppText size={13} muted>{L(n.bodyEn, n.bodyHi)}</AppText>
                <AppText size={11} color="#9CA3AF">{formatDateTime(n.createdAt, language)}</AppText>
              </View>
              {n.link && <Ionicons name="chevron-forward" size={18} color="#D1D5DB" />}
            </Pressable>
          )}
          ListEmptyComponent={<StateView icon="notifications-outline" title={t('notifications.empty')} />}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radius.md, backgroundColor: '#F9FAFB' },
  unread: { backgroundColor: '#FFFBEB' },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
