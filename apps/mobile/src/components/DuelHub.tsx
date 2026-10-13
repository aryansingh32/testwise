import { Ionicons } from '@expo/vector-icons';
import type { DuelHistoryDto, DuelLeaderRowDto, DuelProfileDto, ExamDto } from '@testwise/shared';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { api, ApiError } from '../lib/api';
import { useLocalized } from '../lib/format';
import { useSession } from '../lib/session';
import { palette, radius } from '../theme/tokens';
import { AppText, Avatar, Button, Chip, Loading, StateView, arena, useFont } from './ui';

export function DuelHub() {
  const { t } = useTranslation();
  const L = useLocalized();
  const font = useFont();
  const { language } = useSession();
  const [examId, setExamId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const profile = useQuery({ queryKey: ['duel-profile'], queryFn: () => api<DuelProfileDto>('/v1/duels/me') });
  const history = useQuery({ queryKey: ['duel-history'], queryFn: () => api<DuelHistoryDto[]>('/v1/duels/history') });
  const exams = useQuery({ queryKey: ['catalog-exams'], queryFn: () => api<ExamDto[]>('/v1/catalog/exams', { auth: false }) });
  const p = profile.data;

  async function challenge() {
    setBusy(true);
    try {
      const c = await api<{ id: string; inviteCode: string }>('/v1/duels/challenge', { method: 'POST', body: { examId } });
      router.push({ pathname: '/duels/play', params: { host: c.id, code: c.inviteCode } });
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const outcomeColor = (o: string) => (o === 'WIN' ? palette.green : o === 'LOSS' ? palette.red : '#9CA3AF');
  const progress = p?.tier.nextAt ? Math.max(0, Math.min(1, (p.rating - (p.tier.nextAt - 150)) / 150)) : 1;

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 12, gap: 16, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={profile.isRefetching} onRefresh={() => { void profile.refetch(); void history.refetch(); }} tintColor="#FFFFFF" />}>
      {profile.isLoading ? <Loading theme={arena} /> : p && (
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={[styles.tierBadge, { borderColor: p.tier.color }]}><Ionicons name="shield" size={26} color={p.tier.color} /></View>
            <View style={{ flex: 1 }}>
              <AppText weight="extrabold" size={13} color={p.tier.color}>{(language === 'HI' ? p.tier.nameHi : p.tier.name).toUpperCase()}</AppText>
              <AppText weight="extrabold" size={30} color="#FFFFFF">{p.rating}</AppText>
              <AppText size={12} color="rgba(255,255,255,0.65)">{t('duels.record', { w: p.wins, l: p.losses, d: p.draws })}{p.rank ? ` · ${t('duels.rank', { rank: p.rank })}` : ''}</AppText>
            </View>
            {p.streak > 1 && <View style={styles.streak}><Ionicons name="flame" size={14} color={palette.amber} /><AppText weight="extrabold" size={13} color="#FFFFFF">{p.streak}</AppText></View>}
          </View>
          <View style={styles.bar}><View style={[styles.barFill, { width: `${progress * 100}%`, backgroundColor: p.tier.color }]} /></View>
          <AppText size={11} color="rgba(255,255,255,0.55)">{p.tier.nextName && p.tier.nextAt ? t('duels.toNext', { points: p.tier.nextAt - p.rating, tier: p.tier.nextName }) : t('duels.topTier')}</AppText>
        </View>
      )}

      <AppText weight="bold" size={13} theme={arena} muted>{t('duels.exam')}</AppText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ marginTop: -8 }}>
        <Chip theme={arena} label={t('duels.anyExam')} active={!examId} onPress={() => setExamId(null)} />
        {exams.data?.map((e) => <Chip key={e.id} theme={arena} label={L(e.nameEn, e.nameHi) ?? e.nameEn} active={examId === e.id} onPress={() => setExamId(e.id)} />)}
      </ScrollView>

      <Button title={t('duels.findMatch')} icon="flash" onPress={() => router.push({ pathname: '/duels/play', params: { examId: examId ?? '' } })} />
      <Button title={t('duels.challenge')} icon="people" variant="light" onPress={challenge} loading={busy} />
      <View style={styles.codeRow}>
        <TextInput value={code} onChangeText={(v) => setCode(v.toUpperCase())} placeholder={t('duels.codePlaceholder')} placeholderTextColor="rgba(255,255,255,0.4)" autoCapitalize="characters" maxLength={8} style={[styles.codeInput, { fontFamily: font('bold') }]} />
        <Pressable onPress={() => router.push({ pathname: '/duels/play', params: { join: code.trim() } })} disabled={code.trim().length < 4} style={[styles.joinBtn, code.trim().length < 4 && { opacity: 0.4 }]}>
          <AppText weight="bold" size={14} color={palette.ink}>{t('duels.join')}</AppText>
        </Pressable>
      </View>

      <AppText weight="bold" size={16} theme={arena}>{t('duels.recent')}</AppText>
      {!history.data?.length ? (
        <AppText size={13} theme={arena} muted>{t('duels.noDuels')}</AppText>
      ) : history.data.map((h, i) => (
        <View key={h.id} style={styles.row}>
          <Avatar name={h.opponentName} size={38} ring={i} />
          <View style={{ flex: 1 }}>
            <AppText weight="bold" size={14} theme={arena}>{h.opponentName}</AppText>
            <AppText size={12} theme={arena} muted>{h.yourScore} – {h.opponentScore}</AppText>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <AppText weight="extrabold" size={13} color={outcomeColor(h.outcome)}>{t(`duels.${h.outcome.toLowerCase()}`)}</AppText>
            {h.ratingChange !== 0 && <AppText size={11} color={h.ratingChange > 0 ? palette.green : palette.red}>{h.ratingChange > 0 ? '+' : ''}{h.ratingChange}</AppText>}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

export function DuelLeagues() {
  const { t } = useTranslation();
  const { config, language } = useSession();
  const { data, isLoading, refetch, isRefetching } = useQuery({ queryKey: ['duel-leaderboard'], queryFn: () => api<DuelLeaderRowDto[]>('/v1/duels/leaderboard') });
  const tiers = [...(config?.['duels.settings'].tiers ?? [])].sort((a, b) => b.minRating - a.minRating);
  if (isLoading) return <Loading theme={arena} />;
  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 12, gap: 10, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#FFFFFF" />}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 8 }}>
        {tiers.map((tier) => (
          <View key={tier.name} style={[styles.tierPill, { borderColor: tier.color }]}>
            <Ionicons name="shield" size={14} color={tier.color} />
            <AppText weight="bold" size={12} color="#FFFFFF">{language === 'HI' ? tier.nameHi : tier.name}</AppText>
            <AppText size={11} color="rgba(255,255,255,0.5)">{tier.minRating}+</AppText>
          </View>
        ))}
      </ScrollView>
      <AppText weight="bold" size={16} theme={arena}>{t('duels.leaderboard')}</AppText>
      {!data?.length ? <StateView theme={arena} icon="podium-outline" title={t('duels.noDuels')} /> : data.map((r, i) => (
        <View key={r.userId} style={[styles.row, r.isMe && { borderColor: palette.amber, borderWidth: 1.5 }]}>
          <AppText weight="extrabold" size={14} color={i < 3 ? palette.amber : 'rgba(255,255,255,0.6)'} style={{ width: 28 }}>{r.rank}</AppText>
          <Avatar name={r.name} size={36} ring={i} />
          <View style={{ flex: 1 }}>
            <AppText weight="bold" size={14} theme={arena} numberOfLines={1}>{r.name}</AppText>
            <AppText size={11} color={r.tierColor}>{r.tier} · {r.wins} W</AppText>
          </View>
          <AppText weight="extrabold" size={15} color="#60A5FA">{r.rating}</AppText>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { padding: 18, gap: 12, borderRadius: radius.lg, backgroundColor: '#16244D', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  tierBadge: { width: 58, height: 58, borderRadius: 29, borderWidth: 3, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  streak: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(245,158,11,0.15)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  bar: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3 },
  codeRow: { flexDirection: 'row', gap: 10 },
  codeInput: { flex: 1, fontSize: 16, letterSpacing: 3, color: '#FFFFFF', paddingHorizontal: 16, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.15)', borderStyle: 'dashed' },
  joinBtn: { paddingHorizontal: 22, justifyContent: 'center', borderRadius: radius.md, backgroundColor: '#FFFFFF' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.md, backgroundColor: '#0F1B3D' },
  tierPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1.5 },
});
