import { Ionicons } from '@expo/vector-icons';
import type { AttemptResultDto } from '@testwise/shared';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Header } from '../../components/Header';
import { ReviewItem } from '../../components/ReviewItem';
import { AppText, Button, Card, ErrorState, Loading, Screen } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDuration, useLocalized } from '../../lib/format';
import { palette, radius } from '../../theme/tokens';

export default function Result() {
  const { attemptId } = useLocalSearchParams<{ attemptId: string }>();
  const { t } = useTranslation();
  const L = useLocalized();
  const { data: r, error, isLoading, refetch } = useQuery({ queryKey: ['result', attemptId], queryFn: () => api<AttemptResultDto>(`/v1/attempts/${attemptId}/result`) });

  if (isLoading) return <Screen><Loading /></Screen>;
  if (error || !r) return <Screen><ErrorState error={error} onRetry={refetch} /></Screen>;
  const pct = r.maxScore ? Math.max(0, Math.round((r.score / r.maxScore) * 100)) : 0;

  return (
    <Screen>
      <Header title={L(r.titleEn, r.titleHi) ?? ''} fallback="/tests" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 4, gap: 16, paddingBottom: 40, maxWidth: 760, width: '100%', alignSelf: 'center' }}>
        <View style={styles.hero}>
          <View style={styles.ring}>
            <AppText weight="extrabold" size={28} color="#FFFFFF">{r.score}</AppText>
            <AppText size={12} color="rgba(255,255,255,0.7)">/ {r.maxScore}</AppText>
          </View>
          <View style={{ flex: 1, gap: 6 }}>
            <AppText weight="extrabold" size={20} color="#FFFFFF">{t('result.title')} · {pct}%</AppText>
            <AppText size={13} color="rgba(255,255,255,0.75)">{t('result.accuracy')} {r.accuracy}% · {t('result.time')} {formatDuration(r.timeTakenSec)}</AppText>
            {r.xpEarned > 0 && <View style={styles.xp}><Ionicons name="flash" size={12} color={palette.ink} /><AppText weight="extrabold" size={11}>{t('result.xpEarned', { xp: r.xpEarned })}</AppText></View>}
          </View>
        </View>

        <View style={styles.stats}>
          {[
            { k: t('result.correct'), v: r.correct, c: palette.green },
            { k: t('result.wrong'), v: r.wrong, c: palette.red },
            { k: t('result.skipped'), v: r.skipped, c: '#6B7280' },
          ].map((s) => (
            <Card key={s.k} style={styles.stat}>
              <AppText weight="extrabold" size={22} color={s.c}>{s.v}</AppText>
              <AppText size={12} muted>{s.k}</AppText>
            </Card>
          ))}
        </View>

        {r.sections.length > 1 && (
          <Card style={{ gap: 12 }}>
            <AppText weight="bold" size={16}>{t('result.sections')}</AppText>
            {r.sections.map((s) => (
              <View key={s.sectionId} style={{ gap: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <AppText weight="semibold" size={13}>{L(s.titleEn, s.titleHi)}</AppText>
                  <AppText weight="bold" size={13}>{s.score}/{s.maxScore}</AppText>
                </View>
                <View style={styles.bar}><View style={[styles.barFill, { width: `${s.maxScore ? Math.max(0, (s.score / s.maxScore) * 100) : 0}%` }]} /></View>
                <AppText size={11} muted>✓ {s.correct} · ✗ {s.wrong} · – {s.skipped}</AppText>
              </View>
            ))}
          </Card>
        )}

        {r.tournamentSlug && <Button title={t('result.leaderboard')} variant="dark" icon="podium-outline" onPress={() => router.push({ pathname: '/tournament/[slug]/results', params: { slug: r.tournamentSlug! } })} />}

        <AppText weight="bold" size={18}>{t('result.review')}</AppText>
        {r.review ? (
          r.review.map((q, i) => <ReviewItem key={q.id} q={q} n={i + 1} />)
        ) : (
          <Card style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Ionicons name="lock-closed-outline" size={20} color={palette.amber} />
            <AppText size={13} style={{ flex: 1 }}>{L(r.answerKeyMessageEn, r.answerKeyMessageHi)}</AppText>
          </Card>
        )}
        <Button title={t('result.done')} variant="secondary" onPress={() => router.replace('/tests')} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20, borderRadius: radius.lg, backgroundColor: '#0B1530' },
  ring: { width: 92, height: 92, borderRadius: 46, borderWidth: 4, borderColor: palette.amber, alignItems: 'center', justifyContent: 'center' },
  xp: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: palette.amber, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  stats: { flexDirection: 'row', gap: 12 },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  bar: { height: 6, borderRadius: 3, backgroundColor: '#F1F2F4', overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: palette.green },
});
