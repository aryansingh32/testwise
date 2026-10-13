import { Ionicons } from '@expo/vector-icons';
import type { QuestionReview } from '@testwise/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useLocalized } from '../lib/format';
import { formatMath } from '../lib/math';
import { palette } from '../theme/tokens';
import { AppText, Card } from './ui';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** Expandable question review: student's answer, the key and the solution. */
export function ReviewItem({ q, n }: { q: QuestionReview; n: number }) {
  const { t } = useTranslation();
  const L = useLocalized();
  const [open, setOpen] = useState(false);
  const letter = (label: string) => LETTERS[q.options.findIndex((o) => o.label === label)] ?? label;
  const icon = q.isCorrect === true ? 'checkmark-circle' : q.isCorrect === false ? 'close-circle' : 'remove-circle';
  const color = q.isCorrect === true ? palette.green : q.isCorrect === false ? palette.red : '#9CA3AF';
  const yours = q.type === 'NUMERIC' ? (q.numericValue != null ? String(q.numericValue) : null) : q.selectedLabels.length ? q.selectedLabels.map(letter).join(', ') : null;
  const correct = q.type === 'NUMERIC' ? String(q.correctNumeric ?? '') : (q.correctLabels ?? []).map(letter).join(', ');
  return (
    <Card style={{ gap: 10 }}>
      <Pressable onPress={() => setOpen(!open)} style={{ flexDirection: 'row', gap: 10 }} accessibilityRole="button">
        <Ionicons name={icon} size={22} color={color} />
        <View style={{ flex: 1 }}>
          <AppText weight="bold" size={14} numberOfLines={open ? undefined : 2}>{n}. {formatMath(L(q.textEn, q.textHi))}</AppText>
          <AppText size={12} muted style={{ marginTop: 4 }}>
            {t('result.yourAnswer')}: {yours ?? t('result.notAnswered')} · {t('result.correctAnswer')}: {correct} · {q.marksAwarded > 0 ? '+' : ''}{q.marksAwarded}
          </AppText>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color="#9CA3AF" />
      </Pressable>
      {open && (
        <View style={{ gap: 8 }}>
          {q.imageUrl && <Image source={{ uri: q.imageUrl }} style={{ width: '100%', height: 180, borderRadius: 10 }} resizeMode="contain" />}
          {q.options.map((o, i) => {
            const isCorrect = q.correctLabels?.includes(o.label);
            const picked = q.selectedLabels.includes(o.label);
            return (
              <View key={o.label} style={[styles.opt, isCorrect && styles.optCorrect, picked && !isCorrect && styles.optWrong]}>
                <AppText weight="extrabold" size={12} color={isCorrect ? palette.green : picked ? palette.red : '#6B7280'}>{LETTERS[i]}</AppText>
                <AppText size={13} style={{ flex: 1 }}>{formatMath(L(o.textEn, o.textHi))}</AppText>
              </View>
            );
          })}
          {(q.solutionEn || q.solutionHi) && (
            <View style={styles.solution}>
              <AppText weight="bold" size={12} color={palette.blue}>{t('result.solution')}</AppText>
              <AppText size={13} style={{ marginTop: 4 }}>{formatMath(L(q.solutionEn, q.solutionHi))}</AppText>
            </View>
          )}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  opt: { flexDirection: 'row', gap: 10, alignItems: 'center', padding: 10, borderRadius: 10, backgroundColor: '#F9FAFB' },
  optCorrect: { backgroundColor: '#ECFDF5' },
  optWrong: { backgroundColor: '#FEF2F2' },
  solution: { padding: 12, borderRadius: 10, backgroundColor: '#EFF6FF' },
});
