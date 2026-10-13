import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Header } from '../components/Header';
import { AppText, Card, ErrorState, Loading, Screen, StateView } from '../components/ui';
import { api } from '../lib/api';
import { useLocalized } from '../lib/format';
import { palette, radius } from '../theme/tokens';

interface Analytics {
  testsTaken: number;
  averageAccuracy: number;
  questionsAnswered: number;
  subjects: { id: string; nameEn: string; nameHi: string | null; correct: number; attempted: number; accuracy: number }[];
  trend: { attemptId: string; percent: number; submittedAt: string }[];
}

const accColor = (a: number) => (a >= 75 ? palette.green : a >= 50 ? palette.amber : palette.red);

export default function Analysis() {
  const { t } = useTranslation();
  const L = useLocalized();
  const { data, error, isLoading, refetch } = useQuery({ queryKey: ['analytics'], queryFn: () => api<Analytics>('/v1/me/analytics') });
  return (
    <Screen>
      <Header title={t('analysis.title')} fallback="/profile" />
      {isLoading ? <Loading /> : error || !data ? <ErrorState error={error} onRetry={refetch} /> : (
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40, maxWidth: 760, width: '100%', alignSelf: 'center' }}>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            {[
              { k: t('analysis.testsTaken'), v: String(data.testsTaken) },
              { k: t('analysis.avgAccuracy'), v: `${data.averageAccuracy}%` },
              { k: t('analysis.answered'), v: String(data.questionsAnswered) },
            ].map((s) => (
              <Card key={s.k} style={{ flex: 1, alignItems: 'center', paddingVertical: 14 }}>
                <AppText weight="extrabold" size={20}>{s.v}</AppText>
                <AppText size={11} muted style={{ textAlign: 'center' }}>{s.k}</AppText>
              </Card>
            ))}
          </View>

          <Pressable onPress={() => router.push('/mistakes')}>
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={styles.icon}><Ionicons name="bookmarks" size={20} color="#FFFFFF" /></View>
              <View style={{ flex: 1 }}>
                <AppText weight="bold" size={15}>{t('analysis.mistakes')}</AppText>
                <AppText size={12} muted>{t('analysis.mistakesBody')}</AppText>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#D1D5DB" />
            </Card>
          </Pressable>

          {data.testsTaken === 0 ? (
            <StateView icon="analytics-outline" title={t('analysis.empty')} />
          ) : (
            <>
              <Card style={{ gap: 14 }}>
                <AppText weight="bold" size={16}>{t('analysis.bySubject')}</AppText>
                {data.subjects.map((s) => (
                  <View key={s.id} style={{ gap: 6 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <AppText weight="semibold" size={13}>{L(s.nameEn, s.nameHi)}</AppText>
                      <AppText weight="bold" size={13} color={accColor(s.accuracy)}>{s.accuracy}% <AppText size={11} muted>({s.correct}/{s.attempted})</AppText></AppText>
                    </View>
                    <View style={styles.bar}><View style={[styles.barFill, { width: `${s.accuracy}%`, backgroundColor: accColor(s.accuracy) }]} /></View>
                  </View>
                ))}
              </Card>
              {data.trend.length > 1 && (
                <Card style={{ gap: 12 }}>
                  <AppText weight="bold" size={16}>{t('analysis.trend')}</AppText>
                  <View style={styles.chart}>
                    {data.trend.map((p) => (
                      <View key={p.attemptId} style={styles.col}>
                        <AppText size={10} muted>{Math.round(p.percent)}</AppText>
                        <View style={[styles.colBar, { height: Math.max(4, (Math.max(0, p.percent) / 100) * 110) }]} />
                      </View>
                    ))}
                  </View>
                </Card>
              )}
            </>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  icon: { width: 44, height: 44, borderRadius: 12, backgroundColor: palette.violet, alignItems: 'center', justifyContent: 'center' },
  bar: { height: 8, borderRadius: 4, backgroundColor: '#F1F2F4', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 140 },
  col: { flex: 1, alignItems: 'center', gap: 4, justifyContent: 'flex-end' },
  colBar: { width: '100%', maxWidth: 28, borderRadius: radius.sm, backgroundColor: palette.amber },
});
