import { Ionicons } from '@expo/vector-icons';
import type { ExamDto } from '@testwise/shared';
import { useQuery } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText, Button, ErrorState, Input, Loading, Screen } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useLocalized } from '../lib/format';
import { useSession } from '../lib/session';
import { palette, radius } from '../theme/tokens';

type Step = 'language' | 'audience' | 'details' | 'age';
const STEPS: Step[] = ['language', 'audience', 'details', 'age'];
const BOARDS = ['CBSE', 'ICSE', 'State Board', 'Other'];

function ageFrom(dob: string) {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) a--;
  return a;
}

function Option({ selected, onPress, icon, title, body }: { selected: boolean; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap; title: string; body?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} style={[styles.option, selected && styles.optionOn]}>
      {icon && (
        <View style={[styles.optionIcon, selected && { backgroundColor: palette.amber }]}>
          <Ionicons name={icon} size={22} color={selected ? '#FFFFFF' : palette.amber} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <AppText weight="bold" size={16}>{title}</AppText>
        {body && <AppText size={13} muted style={{ marginTop: 2 }}>{body}</AppText>}
      </View>
      <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={selected ? palette.amber : '#D1D5DB'} />
    </Pressable>
  );
}

export default function Onboarding() {
  const { t } = useTranslation();
  const L = useLocalized();
  const { user, config, language, setLanguage, onboard } = useSession();
  const adultAge = config?.['policy.age'].adultAge ?? 18;
  const [step, setStep] = useState<Step>('language');
  const [audience, setAudience] = useState<'SCHOOL' | 'EXAM' | null>(null);
  const [classLevel, setClassLevel] = useState<number | null>(null);
  const [board, setBoard] = useState<string | null>(null);
  const [examIds, setExamIds] = useState<string[]>([]);
  const [dob, setDob] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exams = useQuery({ queryKey: ['catalog-exams'], queryFn: () => api<ExamDto[]>('/v1/catalog/exams', { auth: false }) });

  if (!user) return <Redirect href="/intro" />;
  if (user.onboarded) return <Redirect href="/home" />;

  const index = STEPS.indexOf(step);
  const age = /^\d{4}-\d{2}-\d{2}$/.test(dob) ? ageFrom(dob) : null;
  const dobValid = age != null && age >= 5 && age <= 100;
  const minor = dobValid ? age! < adultAge : audience === 'SCHOOL';
  const needsConsent = minor && (config?.['policy.age'].minorRequiresGuardianConsent ?? true);
  const visibleExams = (exams.data ?? []).filter((e) => (audience === 'SCHOOL' ? e.category === 'SCHOOL' : e.category === 'COMPETITIVE'));

  const canNext =
    step === 'language' ||
    (step === 'audience' && !!audience) ||
    (step === 'details' && (audience === 'SCHOOL' ? classLevel != null : examIds.length > 0)) ||
    (step === 'age' && dobValid && (!needsConsent || consent));

  async function next() {
    if (step !== 'age') {
      setStep(STEPS[index + 1]);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onboard({
        audience: audience!,
        classLevel: audience === 'SCHOOL' ? classLevel : null,
        board: audience === 'SCHOOL' ? board : null,
        examIds,
        dateOfBirth: dob,
        guardianConsent: consent,
        language,
      });
    } catch (e) {
      setError(e instanceof ApiError && e.status === 0 ? t('common.offline') : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const toggleExam = (id: string) => setExamIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          {index > 0 ? (
            <Pressable onPress={() => setStep(STEPS[index - 1])} hitSlop={10} style={styles.back} accessibilityLabel={t('common.back')}>
              <Ionicons name="chevron-back" size={22} color={palette.ink} />
            </Pressable>
          ) : (
            <View style={{ width: 40 }} />
          )}
          <View style={styles.progress}>
            {STEPS.map((s, i) => <View key={s} style={[styles.progressSeg, i <= index && { backgroundColor: palette.amber }]} />)}
          </View>
          <AppText size={12} muted numberOfLines={1} style={{ minWidth: 70, textAlign: 'right' }}>{t('onboarding.step', { n: index + 1, total: STEPS.length })}</AppText>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {step === 'language' && (
            <>
              <AppText weight="extrabold" size={26}>{t('onboarding.languageTitle')}</AppText>
              <AppText muted style={styles.sub}>{t('onboarding.languageSubtitle')}</AppText>
              <View style={{ gap: 12 }}>
                <Option selected={language === 'EN'} onPress={() => setLanguage('EN')} title="English" body="Questions and app in English" />
                <Option selected={language === 'HI'} onPress={() => setLanguage('HI')} title="हिन्दी" body="प्रश्न और ऐप हिन्दी में" />
              </View>
            </>
          )}

          {step === 'audience' && (
            <>
              <AppText weight="extrabold" size={26}>{t('onboarding.audienceTitle')}</AppText>
              <View style={{ gap: 12, marginTop: 24 }}>
                <Option selected={audience === 'SCHOOL'} onPress={() => { setAudience('SCHOOL'); setExamIds([]); }} icon="school" title={t('onboarding.school')} body={t('onboarding.schoolDesc')} />
                <Option selected={audience === 'EXAM'} onPress={() => { setAudience('EXAM'); setExamIds([]); setClassLevel(null); }} icon="briefcase" title={t('onboarding.exam')} body={t('onboarding.examDesc')} />
              </View>
            </>
          )}

          {step === 'details' && audience === 'SCHOOL' && (
            <>
              <AppText weight="extrabold" size={26}>{t('onboarding.classTitle')}</AppText>
              <View style={styles.grid}>
                {[6, 7, 8, 9, 10, 11, 12].map((c) => (
                  <Pressable key={c} onPress={() => setClassLevel(c)} style={[styles.classBox, classLevel === c && styles.optionOn]} accessibilityRole="radio" accessibilityState={{ selected: classLevel === c }}>
                    <AppText weight="extrabold" size={22} color={classLevel === c ? palette.amber : palette.ink}>{c}</AppText>
                  </Pressable>
                ))}
              </View>
              <AppText weight="semibold" size={13} muted style={{ marginTop: 24, marginBottom: 10 }}>{t('onboarding.board')}</AppText>
              <View style={styles.chips}>
                {BOARDS.map((b) => (
                  <Pressable key={b} onPress={() => setBoard(board === b ? null : b)} style={[styles.chip, board === b && styles.optionOn]}>
                    <AppText weight="bold" size={13}>{b}</AppText>
                  </Pressable>
                ))}
              </View>
              {visibleExams.length > 0 && (
                <>
                  <AppText weight="semibold" size={13} muted style={{ marginTop: 24, marginBottom: 10 }}>{t('onboarding.examsSubtitle')}</AppText>
                  <View style={styles.chips}>
                    {visibleExams.map((e) => (
                      <Pressable key={e.id} onPress={() => toggleExam(e.id)} style={[styles.chip, examIds.includes(e.id) && styles.optionOn]}>
                        <AppText weight="bold" size={13}>{L(e.nameEn, e.nameHi)}</AppText>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
            </>
          )}

          {step === 'details' && audience === 'EXAM' && (
            <>
              <AppText weight="extrabold" size={26}>{t('onboarding.examsTitle')}</AppText>
              <AppText muted style={styles.sub}>{t('onboarding.examsSubtitle')}</AppText>
              {exams.isLoading ? (
                <Loading />
              ) : exams.error ? (
                <ErrorState error={exams.error} onRetry={() => exams.refetch()} />
              ) : (
                <View style={styles.examGrid}>
                  {visibleExams.map((e) => {
                    const on = examIds.includes(e.id);
                    return (
                      <Pressable key={e.id} onPress={() => toggleExam(e.id)} style={[styles.examBox, on && styles.optionOn]} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                        <View style={[styles.examDot, { backgroundColor: e.color + '22' }]}>
                          <AppText weight="extrabold" size={14} color={e.color}>{e.nameEn.slice(0, 2).toUpperCase()}</AppText>
                        </View>
                        <AppText weight="bold" size={13} style={{ textAlign: 'center' }}>{L(e.nameEn, e.nameHi)}</AppText>
                        {on && <Ionicons name="checkmark-circle" size={18} color={palette.amber} style={{ position: 'absolute', top: 8, right: 8 }} />}
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </>
          )}

          {step === 'age' && (
            <>
              <AppText weight="extrabold" size={26}>{t('onboarding.dobTitle')}</AppText>
              <AppText muted style={styles.sub}>{t('onboarding.dobSubtitle')}</AppText>
              <Input
                label={t('onboarding.dobTitle')}
                icon="calendar-outline"
                value={dob}
                onChangeText={(v) => setDob(v.replace(/[^\d-]/g, '').slice(0, 10))}
                placeholder={t('onboarding.dobPlaceholder')}
                keyboardType="numbers-and-punctuation"
                error={dob.length === 10 && !dobValid ? ' ' : undefined}
              />
              {needsConsent && dobValid && (
                <View style={styles.consent}>
                  <AppText weight="bold" size={15}>{t('onboarding.guardianTitle')}</AppText>
                  <AppText size={13} muted style={{ marginTop: 4 }}>{t('onboarding.guardianBody', { age: adultAge })}</AppText>
                  <Pressable onPress={() => setConsent(!consent)} style={styles.check} accessibilityRole="checkbox" accessibilityState={{ checked: consent }}>
                    <Ionicons name={consent ? 'checkbox' : 'square-outline'} size={22} color={consent ? palette.amber : '#9CA3AF'} />
                    <AppText size={14} style={{ flex: 1 }}>{t('onboarding.guardianCheck')}</AppText>
                  </Pressable>
                </View>
              )}
              {error && <AppText size={13} color={palette.red} style={{ marginTop: 16 }}>{error}</AppText>}
            </>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <Button title={step === 'age' ? t('onboarding.finish') : t('common.continue')} onPress={next} disabled={!canNext} loading={busy} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 8 },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F6F7F9', alignItems: 'center', justifyContent: 'center' },
  progress: { flex: 1, flexDirection: 'row', gap: 6 },
  progressSeg: { flex: 1, height: 5, borderRadius: 3, backgroundColor: '#EEF0F3' },
  content: { padding: 24, paddingTop: 20, maxWidth: 560, width: '100%', alignSelf: 'center' },
  sub: { marginTop: 6, marginBottom: 24 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: radius.lg, borderWidth: 2, borderColor: '#EEF0F3', backgroundColor: '#FFFFFF' },
  optionOn: { borderColor: palette.amber, backgroundColor: '#FFFBEB' },
  optionIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#FFF9F0', alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 24 },
  classBox: { width: 72, height: 72, borderRadius: 18, borderWidth: 2, borderColor: '#EEF0F3', alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 2, borderColor: '#EEF0F3' },
  examGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  examBox: { width: '47%', flexGrow: 1, alignItems: 'center', gap: 10, padding: 16, borderRadius: radius.lg, borderWidth: 2, borderColor: '#EEF0F3' },
  examDot: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  consent: { marginTop: 24, padding: 16, borderRadius: radius.lg, backgroundColor: '#FFFBEB' },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  footer: { padding: 20, paddingTop: 8, maxWidth: 560, width: '100%', alignSelf: 'center' },
});
