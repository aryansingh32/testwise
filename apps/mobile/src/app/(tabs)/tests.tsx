import { Ionicons } from '@expo/vector-icons';
import type { MyTournamentRowDto, SeriesCardDto } from '@testwise/shared';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SeriesCard } from '../../components/SeriesCard';
import { AppText, Card, ErrorState, Loading, Pill, Screen, StateView } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDateTime, useLocalized } from '../../lib/format';
import { useSession } from '../../lib/session';
import { palette, radius } from '../../theme/tokens';

type Tab = 'tournaments' | 'series' | 'history';
interface HistoryRow { id: string; titleEn: string; titleHi: string | null; tournamentSlug: string | null; score: number | null; maxScore: number | null; accuracy: number | null; submittedAt: string | null }

function TournamentRow({ r }: { r: MyTournamentRowDto }) {
  const { t } = useTranslation();
  const L = useLocalized();
  const { language } = useSession();
  const live = r.status === 'LIVE';
  return (
    <Pressable onPress={() => router.push({ pathname: '/tournament/[slug]', params: { slug: r.slug } })} style={({ pressed }) => [styles.tRow, pressed && { opacity: 0.85 }]}>
      <View style={[styles.tColor, { backgroundColor: r.bannerColor }]}><Ionicons name="trophy" size={18} color="#FFFFFF" /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText weight="bold" size={15} numberOfLines={1}>{L(r.titleEn, r.titleHi)}</AppText>
        <AppText size={12} muted>{formatDateTime(r.startsAt, language)}</AppText>
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
          {live && <Pill label={t('tournament.live')} color={palette.red} icon="radio-button-on" />}
          <Pill label={t(`myTests.status.${r.registrationStatus}`)} color="#F3F4F6" textColor="#4B5563" />
          {r.attemptStatus && r.attemptStatus !== 'IN_PROGRESS' && <Pill label={t('register.submitted')} color="#ECFDF5" textColor={palette.green} />}
        </View>
      </View>
      {r.rank ? (
        <View style={{ alignItems: 'flex-end' }}>
          <AppText weight="extrabold" size={18} color={palette.amber}>#{r.rank}</AppText>
          <AppText size={11} muted>{r.score}</AppText>
        </View>
      ) : (
        <Ionicons name="chevron-forward" size={18} color="#D1D5DB" />
      )}
    </Pressable>
  );
}

export default function MyTests() {
  const { t } = useTranslation();
  const L = useLocalized();
  const { language } = useSession();
  const [tab, setTab] = useState<Tab>('tournaments');
  const tournaments = useQuery({ queryKey: ['my-tournaments'], queryFn: () => api<MyTournamentRowDto[]>('/v1/me/tournaments'), enabled: tab === 'tournaments' });
  const series = useQuery({ queryKey: ['my-series'], queryFn: () => api<SeriesCardDto[]>('/v1/me/series'), enabled: tab === 'series' });
  const history = useQuery({ queryKey: ['my-history'], queryFn: () => api<HistoryRow[]>('/v1/me/attempts'), enabled: tab === 'history' });
  const q = tab === 'tournaments' ? tournaments : tab === 'series' ? series : history;

  return (
    <Screen>
      <View style={{ paddingHorizontal: 20, paddingTop: 12, gap: 14 }}>
        <AppText weight="extrabold" size={28}>{t('myTests.title')}</AppText>
        <View style={styles.segment}>
          {(['tournaments', 'series', 'history'] as Tab[]).map((x) => (
            <Pressable key={x} onPress={() => setTab(x)} style={[styles.segBtn, tab === x && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === x }}>
              <AppText weight="bold" size={13} color={tab === x ? palette.ink : '#6B7280'}>{t(`myTests.${x}`)}</AppText>
            </Pressable>
          ))}
        </View>
      </View>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : tab === 'tournaments' ? (
        <FlatList
          data={tournaments.data}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={tournaments.isRefetching} onRefresh={tournaments.refetch} tintColor={palette.amber} />}
          renderItem={({ item }) => <TournamentRow r={item} />}
          ListEmptyComponent={<StateView icon="trophy-outline" title={t('myTests.noTournaments')} action={t('myTests.browse')} onAction={() => router.push('/arena')} />}
        />
      ) : tab === 'series' ? (
        <FlatList
          data={series.data}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={series.isRefetching} onRefresh={series.refetch} tintColor={palette.amber} />}
          renderItem={({ item }) => <SeriesCard s={item} />}
          ListEmptyComponent={<StateView icon="library-outline" title={t('myTests.noSeries')} action={t('myTests.browse')} onAction={() => router.push('/store')} />}
        />
      ) : (
        <FlatList
          data={history.data}
          keyExtractor={(h) => h.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={history.isRefetching} onRefresh={history.refetch} tintColor={palette.amber} />}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push({ pathname: '/result/[attemptId]', params: { attemptId: item.id } })}>
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={styles.score}><AppText weight="extrabold" size={14} color={palette.ink}>{item.maxScore ? Math.round(((item.score ?? 0) / item.maxScore) * 100) : 0}%</AppText></View>
                <View style={{ flex: 1 }}>
                  <AppText weight="bold" size={14} numberOfLines={1}>{L(item.titleEn, item.titleHi)}</AppText>
                  <AppText size={12} muted>{item.score}/{item.maxScore} · {item.accuracy}% · {item.submittedAt ? formatDateTime(item.submittedAt, language) : ''}</AppText>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#D1D5DB" />
              </Card>
            </Pressable>
          )}
          ListEmptyComponent={<StateView icon="time-outline" title={t('myTests.noHistory')} />}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', padding: 4, borderRadius: 14, backgroundColor: '#F3F4F6' },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10 },
  segOn: { backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 1 },
  list: { padding: 20, gap: 12, flexGrow: 1 },
  tRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#F1F2F4' },
  tColor: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  score: { width: 52, height: 52, borderRadius: 26, borderWidth: 3, borderColor: palette.amber, alignItems: 'center', justifyContent: 'center' },
});
