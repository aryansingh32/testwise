import { Ionicons } from '@expo/vector-icons';
import type { ExamDto } from '@testwise/shared';
import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { AppText, Avatar, Card, Screen } from '../../components/ui';
import { api } from '../../lib/api';
import { useLocalized } from '../../lib/format';
import { useSession } from '../../lib/session';
import { palette, radius } from '../../theme/tokens';

function Row({ icon, label, right, onPress, danger }: { icon: keyof typeof Ionicons.glyphMap; label: string; right?: React.ReactNode; onPress?: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]} accessibilityRole="button">
      <View style={[styles.rowIcon, danger && { backgroundColor: '#FEF2F2' }]}>
        <Ionicons name={icon} size={18} color={danger ? palette.red : palette.ink} />
      </View>
      <AppText weight="semibold" size={15} color={danger ? palette.red : undefined} style={{ flex: 1 }}>{label}</AppText>
      {right ?? <Ionicons name="chevron-forward" size={18} color="#D1D5DB" />}
    </Pressable>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 24 }}>
      <AppText weight="bold" size={13} muted style={{ marginBottom: 8, marginLeft: 4 }}>{title}</AppText>
      <Card style={{ paddingVertical: 4 }}>{children}</Card>
    </View>
  );
}

export default function Profile() {
  const { t } = useTranslation();
  const L = useLocalized();
  const { user, language, setLanguage, logout, config } = useSession();
  const exams = useQuery({ queryKey: ['catalog-exams'], queryFn: () => api<ExamDto[]>('/v1/catalog/exams', { auth: false }) });
  const analytics = useQuery({ queryKey: ['analytics'], queryFn: () => api<{ testsTaken: number }>('/v1/me/analytics') });
  if (!user) return null;
  const mine = exams.data?.filter((e) => user.examIds.includes(e.id)) ?? [];

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <View style={styles.hero}>
          <Avatar name={user.displayName} size={72} ring={0} />
          <View style={{ flex: 1 }}>
            <AppText weight="extrabold" size={20} color="#FFFFFF">{user.displayName}</AppText>
            <AppText size={13} color="rgba(255,255,255,0.7)">
              {user.audience === 'SCHOOL' ? t('profile.audienceSchool', { n: user.classLevel }) : t('profile.audienceExam')}
            </AppText>
            <AppText size={12} color="rgba(255,255,255,0.5)">{user.email}</AppText>
          </View>
        </View>

        <View style={styles.stats}>
          {[
            { k: t('profile.streak'), v: String(user.streakDays), icon: 'flame' as const },
            { k: 'XP', v: String(user.xp), icon: 'flash' as const },
            { k: t('analysis.testsTaken'), v: String(analytics.data?.testsTaken ?? '—'), icon: 'document-text' as const },
          ].map((s) => (
            <Card key={s.k} style={styles.stat}>
              <Ionicons name={s.icon} size={18} color={palette.amber} />
              <AppText weight="extrabold" size={20}>{s.v}</AppText>
              <AppText size={11} muted>{s.k}</AppText>
            </Card>
          ))}
        </View>

        {mine.length > 0 && (
          <View style={{ marginTop: 24 }}>
            <AppText weight="bold" size={13} muted style={{ marginBottom: 10 }}>{t('profile.targetExams')}</AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {mine.map((e) => (
                <View key={e.id} style={[styles.examTag, { backgroundColor: e.color + '1A' }]}>
                  <AppText weight="bold" size={12} color={e.color}>{L(e.nameEn, e.nameHi)}</AppText>
                </View>
              ))}
            </View>
          </View>
        )}

        <Group title={t('profile.sectionProgress')}>
          <Row icon="analytics-outline" label={t('analysis.title')} onPress={() => router.push('/analysis')} />
          {config?.['wallet.settings']?.enabled && <Row icon="wallet-outline" label={t('wallet.title')} onPress={() => router.push('/wallet')} />}
          <Row icon="receipt-outline" label={t('orders.title')} onPress={() => router.push('/orders')} />
        </Group>

        <Group title={t('profile.sectionSettings')}>
          <Row
            icon="language"
            label={t('profile.language')}
            onPress={() => setLanguage(language === 'EN' ? 'HI' : 'EN')}
            right={
              <View style={styles.langSwitch}>
                {(['EN', 'HI'] as const).map((l) => (
                  <View key={l} style={[styles.langOpt, language === l && styles.langOn]}>
                    <AppText weight="bold" size={12} color={language === l ? '#FFFFFF' : '#6B7280'}>{l === 'EN' ? 'EN' : 'हि'}</AppText>
                  </View>
                ))}
              </View>
            }
          />
          <Row icon="notifications-outline" label={t('push.settings')} onPress={() => router.push('/notification-settings')} />
          <Row icon="settings-outline" label={t('profile.settings')} onPress={() => router.push('/settings')} />
          <Row icon="shield-checkmark-outline" label={t('profile.privacy')} onPress={() => router.push('/privacy')} />
        </Group>

        <Group title={t('profile.sectionHelp')}>
          <Row icon="help-circle-outline" label={t('profile.help')} onPress={() => router.push('/support')} />
        </Group>

        <Card style={{ marginTop: 16, paddingVertical: 4 }}>
          <Row icon="log-out-outline" label={t('profile.logout')} onPress={logout} danger right={<View />} />
        </Card>
        <AppText size={11} color="#9CA3AF" style={{ textAlign: 'center', marginTop: 20 }}>{t('profile.version', { v: Constants.expoConfig?.version })}</AppText>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20, borderRadius: radius.lg, backgroundColor: '#0B1530' },
  stats: { flexDirection: 'row', gap: 12, marginTop: 16 },
  stat: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 14 },
  examTag: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rowIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#F6F7F9', alignItems: 'center', justifyContent: 'center' },
  langSwitch: { flexDirection: 'row', backgroundColor: '#F3F4F6', borderRadius: 10, padding: 3 },
  langOpt: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  langOn: { backgroundColor: palette.amber },
});
