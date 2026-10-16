import { Ionicons } from '@expo/vector-icons';
import type { CoinRewardsDto } from '@testwise/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Alert, Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { palette, radius } from '../theme/tokens';
import { AppText } from './ui';

const BURST = [-46, -28, -10, 10, 28, 46];

/** Coins flying up from the claim button. Transform + opacity only. */
function Burst({ run }: { run: number }) {
  const t = useRef(BURST.map(() => new Animated.Value(0))).current;
  const last = useRef(0);
  if (run !== last.current) {
    last.current = run;
    t.forEach((v, i) => {
      v.setValue(0);
      Animated.timing(v, { toValue: 1, duration: 900, delay: i * 40, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    });
  }
  return (
    <View pointerEvents="none" style={styles.burst} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {BURST.map((dx, i) => (
        <Animated.View key={dx} style={{ position: 'absolute', opacity: t[i].interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] }), transform: [{ translateX: t[i].interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) }, { translateY: t[i].interpolate({ inputRange: [0, 1], outputRange: [0, -70 - (i % 3) * 14] }) }, { scale: t[i].interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.1] }) }] }}>
          <Ionicons name="logo-bitcoin" size={18} color={palette.amber} />
        </Animated.View>
      ))}
    </View>
  );
}

/**
 * Daily check-in, streak and level. The app displays what the server reports and asks to claim; the amount, the day and
 * the daily cap are all decided on the server, so a modified app cannot mint coins.
 */
export function RewardsCard({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { config } = useSession();
  const on = config?.['gamification.coins']?.enabled && config?.['wallet.settings']?.enabled;
  const q = useQuery({ queryKey: ['coin-rewards'], queryFn: () => api<CoinRewardsDto>('/v1/me/coin-rewards'), enabled: !!on });
  const [busy, setBusy] = useState(false);
  const [burst, setBurst] = useState(0);
  const press = useRef(new Animated.Value(1)).current;
  if (!on || !q.data?.enabled) return null;
  const r = q.data;

  async function claim() {
    setBusy(true);
    try {
      const res = await api<CoinRewardsDto & { granted: number }>('/v1/me/coin-rewards/daily/claim', { method: 'POST' });
      qc.setQueryData(['coin-rewards'], res);
      void qc.invalidateQueries({ queryKey: ['wallet'] });
      void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => { if (!reduce) setBurst((b) => b + 1); });
      if (res.granted > 0) void AccessibilityInfo.announceForAccessibility(t('rewards.coinsAdded', { coins: res.granted }));
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const next = r.milestones.find((m) => !m.reached);
  const claimButton = (
    <Animated.View style={{ transform: [{ scale: press }] }}>
      <Pressable
        accessibilityRole="button"
        disabled={!r.daily.claimable || busy}
        onPress={claim}
        onPressIn={() => Animated.spring(press, { toValue: 0.96, useNativeDriver: true }).start()}
        onPressOut={() => Animated.spring(press, { toValue: 1, useNativeDriver: true }).start()}
        style={[styles.claim, compact && styles.claimCompact, (!r.daily.claimable || busy) && { opacity: 0.55 }]}
      >
        <Ionicons name={r.daily.claimable ? 'gift' : 'checkmark-circle'} size={18} color="#1F2937" />
        <AppText weight="extrabold" size={14} color="#1F2937">{r.daily.claimable ? t('rewards.claim', { coins: r.daily.todayCoins }) : t('rewards.claimed')}</AppText>
      </Pressable>
    </Animated.View>
  );

  // Home screen: a single row with today's gift and the streak. The full level and 7-day grid is on the wallet screen.
  if (compact) {
    return (
      <View style={[styles.card, styles.compact]}>
        <View style={styles.levelBadge}><Ionicons name="gift" size={22} color="#1F2937" /></View>
        <View style={{ flex: 1 }}>
          <AppText weight="extrabold" size={15} color="#FFFFFF">{t('rewards.title')}</AppText>
          <AppText size={12} color="rgba(255,255,255,0.75)" numberOfLines={1}>
            {r.daily.streak > 0 ? `🔥 ${t('rewards.streak', { n: r.daily.streak })}` : t('rewards.compactHint')}
          </AppText>
        </View>
        <View>
          {claimButton}
          <Burst run={burst} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.levelBadge}><AppText weight="extrabold" size={16} color="#1F2937">{r.level.level}</AppText></View>
        <View style={{ flex: 1 }}>
          <AppText weight="extrabold" size={15} color="#FFFFFF">{t('rewards.level', { n: r.level.level })}</AppText>
          <View style={styles.xpTrack}><View style={[styles.xpFill, { width: `${r.level.progressPct}%` }]} /></View>
          <AppText size={11} color="rgba(255,255,255,0.65)">{t('rewards.xpToNext', { xp: r.level.xpForNext - r.level.xpIntoLevel, next: r.level.level + 1 })}</AppText>
        </View>
        {r.daily.streak > 0 && <View style={styles.streak}><Ionicons name="flame" size={14} color={palette.amber} /><AppText weight="extrabold" size={13} color="#FFFFFF">{r.daily.streak}</AppText></View>}
      </View>

      <View style={styles.days}>
        {r.daily.rewards.map((coins, i) => {
          const day = i + 1;
          const done = day < r.daily.cycleDay || (day === r.daily.cycleDay && r.daily.claimedToday);
          const today = day === r.daily.cycleDay;
          return (
            <View key={day} style={[styles.day, today && styles.dayToday, done && styles.dayDone]} accessible accessibilityLabel={`${t('rewards.day', { n: day })}: ${coins}`}>
              <AppText size={10} color={done ? '#1F2937' : 'rgba(255,255,255,0.6)'}>{day}</AppText>
              {done ? <Ionicons name="checkmark" size={14} color="#1F2937" /> : <AppText weight="extrabold" size={12} color={today ? palette.amber : '#FFFFFF'}>{coins}</AppText>}
            </View>
          );
        })}
      </View>

      <View>
        {claimButton}
        <Burst run={burst} />
      </View>
      <AppText size={11} color="rgba(255,255,255,0.6)">
        {next ? t('rewards.milestone', { days: next.days, coins: next.coins }) + ' · ' : ''}{t('rewards.earnedToday', { coins: r.earnedTodayCoins, cap: r.dailyEarnCap })}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 12, borderRadius: radius.lg, backgroundColor: '#0F1B3D' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  levelBadge: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.amber, alignItems: 'center', justifyContent: 'center' },
  xpTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden', marginVertical: 4 },
  xpFill: { height: '100%', borderRadius: 3, backgroundColor: palette.green },
  streak: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(245,158,11,0.15)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  days: { flexDirection: 'row', gap: 6 },
  day: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.06)' },
  dayToday: { borderWidth: 1.5, borderColor: palette.amber },
  dayDone: { backgroundColor: palette.green },
  compact: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  claimCompact: { height: 40, paddingHorizontal: 14 },
  claim: { height: 46, borderRadius: radius.md, backgroundColor: palette.amber, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  burst: { position: 'absolute', left: 0, right: 0, top: 10, alignItems: 'center' },
});
