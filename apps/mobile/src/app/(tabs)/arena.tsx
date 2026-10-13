import { Ionicons } from '@expo/vector-icons';
import type { ExamDto, TournamentCardDto } from '@testwise/shared';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { CoinDuels } from '../../components/CoinDuels';
import { DuelHub, DuelLeagues } from '../../components/DuelHub';
import { TournamentCard } from '../../components/TournamentCard';
import { AppText, Avatar, Chip, ErrorState, Loading, Screen, StateView, arena } from '../../components/ui';
import { api } from '../../lib/api';
import { useLocalized } from '../../lib/format';
import { useSession } from '../../lib/session';
import { palette } from '../../theme/tokens';

type Tab = 'tournaments' | 'duels' | 'coin' | 'leagues';
type Group = 'live' | 'upcoming' | 'past';

export default function Arena() {
  const { t } = useTranslation();
  const L = useLocalized();
  const { config } = useSession();
  const params = useLocalSearchParams<{ exam?: string; tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === 'duels' ? 'duels' : 'tournaments');
  const [group, setGroup] = useState<Group>('upcoming');
  const [examId, setExamId] = useState<string | undefined>(params.exam);
  const [entry, setEntry] = useState<'FREE' | 'PAID' | undefined>();
  const flags = config?.['features.flags'];
  const paidAllowed = config?.['policy.money'].paidEntryEnabled;
  const coinDuelsOn = !!config?.['duels.paid']?.enabled && !!config?.['wallet.settings']?.enabled && flags?.duels !== false;

  useEffect(() => {
    if (params.exam) setExamId(params.exam);
  }, [params.exam]);
  useEffect(() => {
    if (params.tab === 'duels' || params.tab === 'leagues' || params.tab === 'coin') setTab(params.tab);
  }, [params.tab]);

  const exams = useQuery({ queryKey: ['catalog-exams'], queryFn: () => api<ExamDto[]>('/v1/catalog/exams', { auth: false }) });
  const query = new URLSearchParams({ group, ...(examId && { examId }), ...(entry && { entryMode: entry }) }).toString();
  const list = useQuery({
    queryKey: ['tournaments', query],
    queryFn: () => api<TournamentCardDto[]>(`/v1/tournaments?${query}`),
    enabled: tab === 'tournaments',
  });

  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'tournaments', label: t('arena.tournaments'), show: flags?.tournaments !== false },
    { key: 'duels', label: t('arena.duels'), show: flags?.duels !== false },
    { key: 'coin', label: t('coinDuels.title'), show: coinDuelsOn },
    { key: 'leagues', label: t('arena.leagues'), show: flags?.duels !== false },
  ];

  return (
    <Screen theme={arena}>
      <View style={styles.header}>
        <AppText weight="extrabold" size={28} theme={arena}>{t('arena.title')}</AppText>
        <AppText size={13} theme={arena} muted>{t('arena.subtitle')}</AppText>
      </View>

      {tabs.filter((x) => x.show).length > 1 && <View style={styles.segment}>
        {tabs.filter((x) => x.show).map((x) => (
          <Pressable key={x.key} onPress={() => setTab(x.key)} style={[styles.segBtn, tab === x.key && styles.segOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === x.key }}>
            <AppText weight="bold" size={13} color={tab === x.key ? palette.ink : 'rgba(255,255,255,0.7)'}>{x.label}</AppText>
          </Pressable>
        ))}
      </View>}

      {tab === 'tournaments' && (
        <>
          <View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
              {(['live', 'upcoming', 'past'] as Group[]).map((g) => (
                <Chip key={g} theme={arena} label={t(`tournament.${g}`)} active={group === g} onPress={() => setGroup(g)} />
              ))}
              <View style={styles.sep} />
              <Chip theme={arena} label={t('arena.allExams')} active={!examId} onPress={() => setExamId(undefined)} />
              {exams.data?.map((e) => (
                <Chip key={e.id} theme={arena} label={L(e.nameEn, e.nameHi) ?? e.nameEn} active={examId === e.id} onPress={() => setExamId(examId === e.id ? undefined : e.id)} />
              ))}
              {paidAllowed && (
                <>
                  <View style={styles.sep} />
                  <Chip theme={arena} label={t('arena.freeOnly')} active={entry === 'FREE'} onPress={() => setEntry(entry === 'FREE' ? undefined : 'FREE')} />
                  <Chip theme={arena} label={t('arena.paidOnly')} active={entry === 'PAID'} onPress={() => setEntry(entry === 'PAID' ? undefined : 'PAID')} />
                </>
              )}
            </ScrollView>
          </View>
          {list.isLoading ? (
            <Loading theme={arena} />
          ) : list.error ? (
            <ErrorState theme={arena} error={list.error} onRetry={list.refetch} />
          ) : (
            <FlatList
              data={list.data}
              keyExtractor={(i) => i.id}
              contentContainerStyle={{ padding: 20, paddingTop: 4, gap: 16, flexGrow: 1 }}
              refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={list.refetch} tintColor="#FFFFFF" />}
              renderItem={({ item }) => <TournamentCard t={item} />}
              ListEmptyComponent={<StateView theme={arena} icon="trophy-outline" title={t('arena.empty')} />}
            />
          )}
        </>
      )}

      {tab === 'duels' && <DuelHub />}
      {tab === 'coin' && <CoinDuels />}

      {tab === 'leagues' && <DuelLeagues />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 },
  segment: { flexDirection: 'row', marginHorizontal: 20, padding: 4, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.07)' },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10 },
  segOn: { backgroundColor: '#FFFFFF' },
  filters: { paddingHorizontal: 20, paddingVertical: 16, gap: 8, alignItems: 'center' },
  sep: { width: 1, height: 20, backgroundColor: 'rgba(255,255,255,0.15)', marginHorizontal: 4 },
  orbit: { width: 280, height: 280, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  orbitRing: { position: 'absolute', borderRadius: 999, borderWidth: 1, borderColor: 'rgba(96,165,250,0.25)' },
  soon: { flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 20, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(245,158,11,0.12)' },
});
