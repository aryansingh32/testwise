import { Ionicons } from '@expo/vector-icons';
import type { TestCardDto } from '@testwise/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';
import { api, ApiError } from '../lib/api';
import { useLocalized } from '../lib/format';
import { routeToDeviceCheck } from '../lib/proctor/startProctored';
import { palette } from '../theme/tokens';
import { AppText, Button, Card, Pill } from './ui';

/** A practice test row: start, resume, retake or locked, with the last score. */
export function TestCard({ test }: { test: TestCardDto }) {
  const { t } = useTranslation();
  const L = useLocalized();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const exhausted = test.attemptsUsed >= test.maxAttempts && !test.inProgressAttemptId;

  async function start() {
    if (test.inProgressAttemptId) {
      router.push({ pathname: '/exam/[attemptId]', params: { attemptId: test.inProgressAttemptId } });
      return;
    }
    setBusy(true);
    try {
      const paper = await api<{ attemptId: string }>(`/v1/tests/${test.id}/attempts`, { method: 'POST' });
      void qc.invalidateQueries({ queryKey: ['series'] });
      router.push({ pathname: '/exam/[attemptId]', params: { attemptId: paper.attemptId } });
    } catch (e) {
      if (routeToDeviceCheck(e, { kind: 'test', ref: test.id })) return;
      Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <View style={[styles.icon, test.locked && { backgroundColor: '#F3F4F6' }]}>
          <Ionicons name={test.locked ? 'lock-closed' : 'document-text'} size={20} color={test.locked ? '#9CA3AF' : palette.amber} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText weight="bold" size={15}>{L(test.titleEn, test.titleHi)}</AppText>
          <AppText size={12} muted>
            {t('exam.questions', { count: test.questionCount })} · {t('exam.totalMarks', { count: test.totalMarks })} · {t('exam.timeLimit', { count: test.durationMinutes })}
          </AppText>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            {test.freePreview && <Pill label={t('store.freePreview')} color={palette.green} />}
            {!test.locked && <Pill label={t('store.attempts', { used: test.attemptsUsed, max: test.maxAttempts })} color="#F3F4F6" textColor="#6B7280" />}
          </View>
        </View>
      </View>
      {test.lastAttempt && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <AppText size={12} muted>{t('store.lastScore', { score: test.lastAttempt.score ?? 0, max: test.lastAttempt.maxScore ?? 0 })}</AppText>
          <AppText weight="bold" size={12} color={palette.blue} onPress={() => router.push({ pathname: '/result/[attemptId]', params: { attemptId: test.lastAttempt!.id } })}>{t('result.review')} ›</AppText>
        </View>
      )}
      {!test.locked && (
        <Button
          size="md"
          variant={test.inProgressAttemptId ? 'primary' : 'dark'}
          title={test.inProgressAttemptId ? t('store.resume') : exhausted ? t('store.noAttemptsLeft') : test.lastAttempt ? t('store.retake') : t('store.start')}
          disabled={exhausted}
          loading={busy}
          onPress={start}
        />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  icon: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#FFF7E6', alignItems: 'center', justifyContent: 'center' },
});
