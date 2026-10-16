import { Ionicons } from '@expo/vector-icons';
import { formatRupees, type TournamentCardDto } from '@testwise/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { compact, useCountdown, useLocalized } from '../lib/format';
import { palette, radius } from '../theme/tokens';
import { AppText, Pill } from './ui';
import { useCoinPrice } from './Wallet';

/** Every query whose payload carries a tournament's status; refreshed when a countdown runs out. */
const STATUS_QUERIES = ['tournament', 'tournaments', 'tournament-me', 'home', 'my-tournaments'];

/** Which countdown matters most for a tournament right now. */
export function useTournamentClock(t: Pick<TournamentCardDto, 'slug' | 'status' | 'registrationOpensAt' | 'registrationClosesAt' | 'startsAt' | 'endsAt'>) {
  const { t: tr } = useTranslation();
  const qc = useQueryClient();
  const target =
    t.status === 'LIVE' ? t.endsAt : t.status === 'SCHEDULED' ? t.registrationOpensAt : t.status === 'REG_OPEN' ? t.registrationClosesAt : t.startsAt;
  const label =
    t.status === 'LIVE'
      ? tr('tournament.endsIn')
      : t.status === 'SCHEDULED'
        ? tr('tournament.regOpensIn')
        : t.status === 'REG_OPEN'
          ? tr('tournament.regClosesIn')
          : tr('tournament.startsIn');
  const c = useCountdown(target);
  const active = ['LIVE', 'SCHEDULED', 'REG_OPEN', 'REG_CLOSED'].includes(t.status);
  // The server moves the status a few seconds after the target time. Without this the screen sits on 00:00:00 until a manual refresh.
  const expired = active && c.done;
  useEffect(() => {
    if (!expired) return;
    const sync = () => void qc.invalidateQueries({ predicate: (q) => STATUS_QUERIES.includes(q.queryKey[0] as string) });
    sync();
    const id = setInterval(sync, 3000); // stops on its own: once the status changes, `expired` flips back to false
    return () => clearInterval(id);
  }, [expired, t.status, qc]);
  return { label, value: c.label, active };
}

export function TournamentCard({ t, width }: { t: TournamentCardDto; width?: number }) {
  const { t: tr } = useTranslation();
  const L = useLocalized();
  const clock = useTournamentClock(t);
  const coinPrice = useCoinPrice();
  const fill = t.maxParticipants ? Math.min(1, t.participantCount / t.maxParticipants) : 0;
  const reward = t.prizePoolPaise > 0 ? formatRupees(t.prizePoolPaise) : L(t.topRewardEn, t.topRewardHi);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/tournament/[slug]', params: { slug: t.slug } })}
      style={({ pressed }) => [{ width, opacity: pressed ? 0.92 : 1 }]}
    >
      <LinearGradient colors={[t.bannerColor, '#0B1530']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
        <View style={styles.glow} />
        <View style={styles.row}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {t.status === 'LIVE' ? (
              <Pill label={tr('tournament.live')} color={palette.red} icon="radio-button-on" />
            ) : (
              <Pill label={tr(`tournament.formats.${t.format}`)} color="rgba(255,255,255,0.18)" />
            )}
            {t.exam && <Pill label={L(t.exam.nameEn, t.exam.nameHi) ?? ''} color="rgba(255,255,255,0.12)" />}
          </View>
          <AppText weight="extrabold" size={12} color={t.entryMode === 'FREE' ? '#6EE7B7' : '#FCD34D'}>
            {t.entryMode === 'FREE' ? tr('common.free') : coinPrice(t.entryFeePaise)}
          </AppText>
        </View>

        <AppText weight="extrabold" size={19} color="#FFFFFF" numberOfLines={2} style={{ marginTop: 12 }}>
          {L(t.titleEn, t.titleHi)}
        </AppText>
        <AppText size={12} color="rgba(255,255,255,0.7)" style={{ marginTop: 4 }}>
          {tr('tournament.questions', { count: t.questionCount })} · {tr('tournament.minutes', { count: t.durationMinutes })}
        </AppText>

        {reward && (
          <View style={styles.reward}>
            <Ionicons name="trophy" size={14} color={palette.amber} />
            <AppText weight="bold" size={12} color="#FFFFFF" numberOfLines={1} style={{ flex: 1 }}>
              {reward}
            </AppText>
          </View>
        )}

        <View style={{ marginTop: 'auto' }}>
          <View style={styles.bar}>
            <View style={[styles.barFill, { width: `${Math.max(fill * 100, 2)}%` }]} />
          </View>
          <View style={[styles.row, { marginTop: 8 }]}>
            <AppText size={11} color="rgba(255,255,255,0.7)">
              {tr('tournament.registered', { joined: compact(t.participantCount), max: compact(t.maxParticipants) })}
            </AppText>
            {clock.active && (
              <View style={styles.clock}>
                <Ionicons name="time-outline" size={12} color="#FFFFFF" />
                <AppText weight="bold" size={11} color="#FFFFFF" style={{ fontVariant: ['tabular-nums'] }}>
                  {clock.value}
                </AppText>
              </View>
            )}
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: 18, minHeight: 210, overflow: 'hidden' },
  glow: { position: 'absolute', width: 180, height: 180, borderRadius: 90, right: -60, top: -60, backgroundColor: 'rgba(255,255,255,0.08)' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reward: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    marginBottom: 14,
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  bar: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3, backgroundColor: palette.amber },
  clock: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
});
