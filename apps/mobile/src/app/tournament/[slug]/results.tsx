import { Ionicons } from '@expo/vector-icons';
import { formatRupees, type LeaderboardRowDto, type TournamentResultDto } from '@testwise/shared';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, Linking, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Header } from '../../../components/Header';
import { AppText, Avatar, Button, ErrorState, Loading, Pill, Screen, StateView, arena } from '../../../components/ui';
import { api } from '../../../lib/api';
import { formatDateTime, formatDuration, useLocalized } from '../../../lib/format';
import { useSession } from '../../../lib/session';
import { palette, radius } from '../../../theme/tokens';

const REWARD_STEPS = ['ELIGIBLE', 'APPROVED', 'PAID'] as const;

function Row({ r, i }: { r: LeaderboardRowDto; i: number }) {
  const { t } = useTranslation();
  return (
    <View style={[styles.row, r.isMe && styles.rowMe, r.disqualified && { opacity: 0.5 }]}>
      <AppText weight="extrabold" size={14} color={r.rank === 1 ? palette.amber : 'rgba(255,255,255,0.6)'} style={{ width: 32 }}>{r.rank ?? '—'}</AppText>
      <Avatar name={r.displayName} size={36} ring={i} />
      <View style={{ flex: 1 }}>
        <AppText weight="bold" size={14} theme={arena} numberOfLines={1}>{r.isMe ? `${r.displayName} (${t('results.you')})` : r.displayName}</AppText>
        <AppText size={11} theme={arena} muted>{r.accuracy}% · {formatDuration(r.timeTakenSec)}</AppText>
      </View>
      <AppText weight="extrabold" size={15} color={r.isMe ? palette.amber : '#60A5FA'}>{r.score}</AppText>
    </View>
  );
}

export default function TournamentResults() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { t } = useTranslation();
  const L = useLocalized();
  const { language } = useSession();
  const { data: r, error, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['tournament-results', slug],
    queryFn: () => api<TournamentResultDto>(`/v1/tournaments/${slug}/results`),
    refetchInterval: (q) => (q.state.data?.resultStatus === 'LIVE' ? 20_000 : false),
  });

  if (isLoading) return <Screen theme={arena}><Loading theme={arena} /></Screen>;
  if (error || !r) return <Screen theme={arena}><ErrorState theme={arena} error={error} onRetry={refetch} /></Screen>;

  const me = r.me;
  const statusPill = r.resultStatus === 'FINAL' ? { label: t('results.final'), color: palette.green } : r.resultStatus === 'PROVISIONAL' ? { label: t('results.provisional'), color: palette.amber } : r.resultStatus === 'LIVE' ? { label: t('results.live'), color: palette.red } : null;
  const note =
    r.resultStatus === 'FINAL' && r.publishedAt ? t('results.finalNote', { date: formatDateTime(r.publishedAt, language) })
      : r.resultStatus === 'PROVISIONAL' && r.appealDeadline ? t('results.provisionalNote', { date: formatDateTime(r.appealDeadline, language) })
        : r.resultStatus === 'LIVE' ? t('results.liveNote') : null;
  const stepIndex = me ? REWARD_STEPS.indexOf(me.rewardStatus as (typeof REWARD_STEPS)[number]) : -1;

  return (
    <Screen theme={arena}>
      <Header title={L(r.titleEn, r.titleHi) ?? ''} theme={arena} fallback="/tests" />
      <FlatList
        data={r.leaderboard}
        keyExtractor={(x) => x.userId}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#FFFFFF" />}
        contentContainerStyle={{ padding: 20, paddingTop: 4, gap: 8, paddingBottom: 40, maxWidth: 760, width: '100%', alignSelf: 'center' }}
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {statusPill && <Pill label={statusPill.label} color={statusPill.color} />}
              <AppText size={12} theme={arena} muted>{t('results.participants', { count: r.participants })}</AppText>
            </View>
            {note && <AppText size={12} theme={arena} muted>{note}</AppText>}

            {me && (
              <View style={styles.meCard}>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={styles.meStat}>
                    <AppText size={11} color="rgba(255,255,255,0.6)">{t('results.yourRank')}</AppText>
                    <AppText weight="extrabold" size={30} color="#FFFFFF">{me.rank ? `#${me.rank}` : '—'}</AppText>
                  </View>
                  <View style={styles.meStat}>
                    <AppText size={11} color="rgba(255,255,255,0.6)">{t('result.score')}</AppText>
                    <AppText weight="extrabold" size={30} color="#FFFFFF">{me.score}</AppText>
                  </View>
                  <View style={styles.meStat}>
                    <AppText size={11} color="rgba(255,255,255,0.6)">{t('results.percentile')}</AppText>
                    <AppText weight="extrabold" size={30} color="#FFFFFF">{me.percentile != null ? Math.round(me.percentile) : '—'}</AppText>
                  </View>
                </View>
                {!me.rank && !me.disqualified && <AppText size={12} color="rgba(255,255,255,0.6)">{t('results.notRanked')}</AppText>}
                {me.disqualified && <AppText size={13} color="#FCA5A5">{t('results.disqualified', { reason: me.dqReason ?? '' })}</AppText>}
                {me.rewardStatus !== 'NONE' && (
                  <View style={styles.reward}>
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                      <Ionicons name="trophy" size={18} color={palette.amber} />
                      <AppText weight="bold" size={14} color="#FFFFFF" style={{ flex: 1 }}>
                        {[me.rewardPaise ? formatRupees(me.rewardPaise) : null, L(me.rewardEn, me.rewardHi)].filter(Boolean).join(' + ')}
                      </AppText>
                    </View>
                    {me.rewardStatus === 'WITHHELD' ? (
                      <AppText size={12} color="#FCA5A5">{t('results.rewardStatus.WITHHELD')}</AppText>
                    ) : (
                      <View style={styles.steps}>
                        {REWARD_STEPS.map((s, i) => (
                          <View key={s} style={{ flex: 1, gap: 4 }}>
                            <View style={[styles.step, i <= stepIndex && { backgroundColor: palette.amber }]} />
                            <AppText size={10} color={i <= stepIndex ? '#FFFFFF' : 'rgba(255,255,255,0.4)'}>{t(`results.rewardStatus.${s}`)}</AppText>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                )}
                <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                  <Pressable onPress={() => router.push({ pathname: '/result/[attemptId]', params: { attemptId: me.attemptId } })} style={styles.link}>
                    <Ionicons name="document-text-outline" size={14} color="#FFFFFF" /><AppText weight="bold" size={12} color="#FFFFFF">{t('result.review')}</AppText>
                  </Pressable>
                  {r.resultStatus === 'PROVISIONAL' && (
                    <Pressable onPress={() => router.push({ pathname: '/support/new', params: { category: 'RESULT_APPEAL', tournamentId: r.tournamentId, subject: `Appeal: ${r.titleEn}` } })} style={styles.link}>
                      <Ionicons name="flag-outline" size={14} color="#FFFFFF" /><AppText weight="bold" size={12} color="#FFFFFF">{t('results.appeal')}</AppText>
                    </Pressable>
                  )}
                </View>
              </View>
            )}
            {r.verifyUrl && <Button title={t('results.verify')} variant="light" icon="shield-checkmark-outline" size="md" onPress={() => Linking.openURL(r.verifyUrl!)} />}
            <AppText weight="bold" size={16} theme={arena} style={{ marginTop: 6 }}>{t('results.leaderboard')}</AppText>
          </View>
        }
        renderItem={({ item, index }) => <Row r={item} i={index} />}
        ListEmptyComponent={<StateView theme={arena} icon="podium-outline" title={t('results.noResults')} />}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  meCard: { padding: 18, gap: 14, borderRadius: radius.lg, backgroundColor: '#16244D', borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)' },
  meStat: { flex: 1, gap: 2 },
  reward: { gap: 10, padding: 12, borderRadius: radius.md, backgroundColor: 'rgba(0,0,0,0.25)' },
  steps: { flexDirection: 'row', gap: 8 },
  step: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)' },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.md, backgroundColor: '#0F1B3D' },
  rowMe: { borderWidth: 1.5, borderColor: palette.amber },
});
