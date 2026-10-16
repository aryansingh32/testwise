import { Ionicons } from '@expo/vector-icons';
import { formatRupees, type TournamentDetailDto } from '@testwise/shared';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTournamentClock } from '../../../components/TournamentCard';
import { useCoinPrice } from '../../../components/Wallet';
import { TournamentActions } from '../../../components/TournamentActions';
import { AppText, ErrorState, Loading, Pill, Screen, arena } from '../../../components/ui';
import { api } from '../../../lib/api';
import { compact, formatDateTime, useLocalized } from '../../../lib/format';
import { useSession } from '../../../lib/session';
import { palette, radius } from '../../../theme/tokens';

function Block({ title, icon, children }: { title: string; icon: keyof typeof Ionicons.glyphMap; children: ReactNode }) {
  return (
    <View style={styles.block}>
      <View style={styles.blockHead}>
        <Ionicons name={icon} size={16} color={palette.amber} />
        <AppText weight="bold" size={15} theme={arena}>{title}</AppText>
      </View>
      {children}
    </View>
  );
}

function Expandable({ text }: { text: string | null }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const long = text.length > 220;
  return (
    <Pressable onPress={() => long && setOpen(!open)}>
      <AppText size={13} theme={arena} muted numberOfLines={open || !long ? undefined : 4}>{text}</AppText>
      {long && <AppText weight="bold" size={12} color={palette.amber} style={{ marginTop: 6 }}>{open ? '−' : '+'}</AppText>}
    </Pressable>
  );
}

function KV({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <View style={styles.kv}>
      <AppText size={13} theme={arena} muted>{k}</AppText>
      <AppText weight={strong ? 'extrabold' : 'semibold'} size={13} theme={arena}>{v}</AppText>
    </View>
  );
}

export default function TournamentDetail() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { t } = useTranslation();
  const L = useLocalized();
  const { language } = useSession();
  const insets = useSafeAreaInsets();
  const { data: d, error, isLoading, refetch } = useQuery({
    queryKey: ['tournament', slug],
    queryFn: () => api<TournamentDetailDto>(`/v1/tournaments/${slug}`, { auth: false }),
    // Status is time-driven on the server (registration opens/closes, goes live); keep the screen in step with it.
    refetchInterval: (q) => (['SCHEDULED', 'REG_OPEN', 'REG_CLOSED', 'LIVE'].includes(q.state.data?.status ?? '') ? 20_000 : false),
  });

  if (isLoading) return <Screen theme={arena}><Loading theme={arena} /></Screen>;
  if (error || !d) return <Screen theme={arena}><ErrorState theme={arena} error={error} onRetry={refetch} /></Screen>;
  return <Detail d={d} insetsBottom={insets.bottom} language={language} t={t} L={L} />;
}

function Detail({ d, insetsBottom, language, t, L }: { d: TournamentDetailDto; insetsBottom: number; language: 'EN' | 'HI'; t: ReturnType<typeof useTranslation>['t']; L: ReturnType<typeof useLocalized> }) {
  const coinPrice = useCoinPrice();
  const clock = useTournamentClock(d);
  const fill = Math.min(1, d.participantCount / d.maxParticipants);
  const el = d.eligibility;
  const eligibility = [
    el.audience?.length ? el.audience.map((a) => (a === 'SCHOOL' ? t('tournament.eligibleSchool') : t('tournament.eligibleExam'))).join(' · ') : null,
    el.classLevels?.length ? t('tournament.eligibleClasses', { list: el.classLevels.join(', ') }) : null,
    el.minAge || el.maxAge ? t('tournament.eligibleAge', { range: `${el.minAge ?? ''}–${el.maxAge ?? ''}` }) : null,
  ].filter(Boolean) as string[];

  return (
    <Screen theme={arena} edges={[]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 + insetsBottom }}>
        <LinearGradient colors={[d.bannerColor, '#050A1A']} style={styles.hero}>
          <View style={styles.heroTop}>
            <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/arena'))} style={styles.roundBtn} accessibilityLabel={t('common.back')}>
              <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
            </Pressable>
            <Pressable onPress={() => Share.share({ message: `${L(d.titleEn, d.titleHi)} — Testwise` })} style={styles.roundBtn} accessibilityLabel="Share">
              <Ionicons name="share-outline" size={20} color="#FFFFFF" />
            </Pressable>
          </View>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 24 }}>
            {d.status === 'LIVE' && <Pill label={t('tournament.live')} color={palette.red} icon="radio-button-on" />}
            <Pill label={t(`tournament.formats.${d.format}`)} color="rgba(255,255,255,0.18)" />
            {d.exam && <Pill label={L(d.exam.nameEn, d.exam.nameHi) ?? ''} color="rgba(255,255,255,0.12)" />}
          </View>
          <AppText weight="extrabold" size={28} color="#FFFFFF" style={{ marginTop: 10 }}>{L(d.titleEn, d.titleHi)}</AppText>

          {clock.active && d.status !== 'CANCELLED' && (
            <View style={styles.countdown}>
              <AppText size={12} color="rgba(255,255,255,0.7)">{clock.label}</AppText>
              <AppText weight="extrabold" size={26} color="#FFFFFF" style={{ fontVariant: ['tabular-nums'] }}>{clock.value}</AppText>
            </View>
          )}

          <View style={styles.statsRow}>
            {[
              { icon: 'help-circle-outline' as const, v: String(d.questionCount), k: t('tournament.questions', { count: d.questionCount }).replace(String(d.questionCount), '').trim() },
              { icon: 'time-outline' as const, v: String(d.durationMinutes), k: t('tournament.minutes', { count: d.durationMinutes }).replace(String(d.durationMinutes), '').trim() },
              { icon: 'trophy-outline' as const, v: String(d.winnerCount), k: t('tournament.winners', { count: d.winnerCount }).replace(String(d.winnerCount), '').trim() },
            ].map((s) => (
              <View key={s.icon} style={styles.stat}>
                <Ionicons name={s.icon} size={16} color={palette.amber} />
                <AppText weight="extrabold" size={18} color="#FFFFFF">{s.v}</AppText>
                <AppText size={11} color="rgba(255,255,255,0.6)">{s.k}</AppText>
              </View>
            ))}
          </View>

          <View style={{ marginTop: 18 }}>
            <View style={styles.bar}><View style={[styles.barFill, { width: `${Math.max(fill * 100, 2)}%` }]} /></View>
            <View style={[styles.kv, { marginTop: 8 }]}>
              <AppText size={12} color="rgba(255,255,255,0.7)">{t('tournament.registered', { joined: compact(d.participantCount), max: compact(d.maxParticipants) })}</AppText>
              <AppText weight="bold" size={12} color={palette.amber}>{t('tournament.seatsLeft', { seats: Math.max(0, d.maxParticipants - d.participantCount).toLocaleString('en-IN') })}</AppText>
            </View>
          </View>
        </LinearGradient>

        <View style={{ paddingHorizontal: 20, gap: 14, marginTop: 4 }}>
          <View style={styles.trust}>
            <Ionicons name="shield-checkmark" size={22} color={palette.green} />
            <View style={{ flex: 1 }}>
              <AppText weight="bold" size={14} theme={arena}>{t('tournament.transparencyTitle')}</AppText>
              <AppText size={12} theme={arena} muted>{t('tournament.transparencyBody')}</AppText>
            </View>
          </View>

          {d.descriptionEn && (
            <Block title={t('tournament.about')} icon="information-circle-outline">
              <Expandable text={L(d.descriptionEn, d.descriptionHi)} />
            </Block>
          )}

          <Block title={t('tournament.prizeTable')} icon="trophy-outline">
            {d.prizeTiers.length ? (
              <>
                {d.prizeTiers.map((p, i) => (
                  <View key={i} style={[styles.prizeRow, i === 0 && styles.prizeTop]}>
                    <View style={[styles.rankBadge, i === 0 && { backgroundColor: palette.amber }]}>
                      <AppText weight="extrabold" size={12} color={i === 0 ? palette.ink : '#FFFFFF'}>{p.fromRank === p.toRank ? `#${p.fromRank}` : `#${p.fromRank}–${p.toRank}`}</AppText>
                    </View>
                    <AppText weight="semibold" size={13} theme={arena} style={{ flex: 1 }}>
                      {[p.amountPaise > 0 ? formatRupees(p.amountPaise) : null, L(p.rewardEn, p.rewardHi)].filter(Boolean).join(' + ')}
                    </AppText>
                  </View>
                ))}
                <AppText size={12} theme={arena} muted style={{ marginTop: 8 }}>
                  {t('tournament.fundedBy', { source: d.sponsorName ?? t(`tournament.funding.${d.fundingSource}`) })}
                </AppText>
              </>
            ) : (
              <AppText size={13} theme={arena} muted>{t('tournament.noPrizes')}</AppText>
            )}
          </Block>

          <Block title={t('tournament.feeBreakdown')} icon="receipt-outline">
            {d.entryMode === 'FREE' ? (
              <AppText size={13} theme={arena} muted>{t('tournament.freeEntry')}</AppText>
            ) : (
              <>
                <KV k={t('tournament.entryFee')} v={coinPrice(d.entryFeePaise)} strong />
                {d.platformFeePercent > 0 && <KV k={t('tournament.platformFee')} v={`${d.platformFeePercent}%`} />}
              </>
            )}
          </Block>

          <Block title={t('tournament.schedule')} icon="calendar-outline">
            <KV k={t('tournament.regOpens')} v={formatDateTime(d.registrationOpensAt, language)} />
            <KV k={t('tournament.regCloses')} v={formatDateTime(d.registrationClosesAt, language)} />
            <KV k={t('tournament.testStarts')} v={formatDateTime(d.startsAt, language)} />
            <KV k={t('tournament.testEnds')} v={formatDateTime(d.endsAt, language)} />
            <KV k={t('tournament.duration')} v={t('tournament.minutes', { count: d.durationMinutes })} />
          </Block>

          <Block title={t('tournament.eligibility')} icon="people-outline">
            <AppText size={13} theme={arena}>{eligibility.length ? eligibility.join(' · ') : t('tournament.eligibleEveryone')}</AppText>
            {d.minParticipants > 1 && <AppText size={12} theme={arena} muted style={{ marginTop: 6 }}>{t('tournament.minParticipants', { count: d.minParticipants })}</AppText>}
          </Block>

          {d.rulesEn && <Block title={t('tournament.rules')} icon="list-outline"><Expandable text={L(d.rulesEn, d.rulesHi)} /></Block>}
          {d.scoringEn && <Block title={t('tournament.scoring')} icon="calculator-outline"><Expandable text={L(d.scoringEn, d.scoringHi)} /></Block>}
          {d.refundPolicyEn && <Block title={t('tournament.refunds')} icon="return-up-back-outline"><Expandable text={L(d.refundPolicyEn, d.refundPolicyHi)} /></Block>}

          <Block title={t('tournament.ruleChanges')} icon="git-commit-outline">
            {d.ruleChanges.length ? (
              d.ruleChanges.map((r) => (
                <View key={r.id} style={{ marginBottom: 10 }}>
                  <AppText size={11} theme={arena} muted>{formatDateTime(r.createdAt, language)}</AppText>
                  <AppText size={13} theme={arena}>{L(r.summaryEn, r.summaryHi)}</AppText>
                </View>
              ))
            ) : (
              <AppText size={13} theme={arena} muted>{t('tournament.noRuleChanges')}</AppText>
            )}
          </Block>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: 16 + insetsBottom }]}>
        <TournamentActions d={d} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 24 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between' },
  roundBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  countdown: { marginTop: 16, padding: 14, borderRadius: radius.md, backgroundColor: 'rgba(0,0,0,0.25)', alignSelf: 'flex-start' },
  statsRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  stat: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 12, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.07)' },
  bar: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: palette.amber, borderRadius: 3 },
  trust: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14, borderRadius: radius.md, backgroundColor: 'rgba(16,185,129,0.1)', borderWidth: 1, borderColor: 'rgba(16,185,129,0.25)' },
  block: { padding: 16, borderRadius: radius.lg, backgroundColor: '#0F1B3D', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  blockHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4 },
  prizeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  prizeTop: { backgroundColor: 'rgba(245,158,11,0.08)', marginHorizontal: -8, paddingHorizontal: 8, borderRadius: 12 },
  rankBadge: { minWidth: 56, alignItems: 'center', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.1)' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 12, backgroundColor: '#050A1A', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
});
