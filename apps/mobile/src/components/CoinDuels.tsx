import { Ionicons } from '@expo/vector-icons';
import type { PaidDuelOfferDto } from '@testwise/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Animated, Easing, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { api, ApiError } from '../lib/api';
import { useLocalized } from '../lib/format';
import { useSession } from '../lib/session';
import { palette, radius } from '../theme/tokens';
import { useWallet } from './Wallet';
import { AppText, Button, StateView, Loading, arena } from './ui';

/** A coin glyph that breathes slowly. Transform-only, native driver. */
function Coin({ size = 18 }: { size?: number }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }), Animated.timing(pulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true })]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View style={{ transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) }] }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Ionicons name="logo-bitcoin" size={size} color={palette.amber} />
    </Animated.View>
  );
}

function OfferCard({ o, index, balance, onJoin, busy }: { o: PaidDuelOfferDto; index: number; balance: number; onJoin: (o: PaidDuelOfferDto) => void; busy: boolean }) {
  const { t } = useTranslation();
  const L = useLocalized();
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 420, delay: Math.min(index, 6) * 70, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [enter, index]);
  const canAfford = balance >= o.entryCoins;
  const full = o.openRooms + o.waitingRooms === 0;
  const resume = !!o.myRoom;
  return (
    <Animated.View style={[styles.card, { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] }]}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <AppText weight="extrabold" size={16} theme={arena} numberOfLines={2}>{L(o.titleEn, o.titleHi)}</AppText>
          <AppText size={12} theme={arena} muted>{t('coinDuels.questions', { q: o.questionCount, s: o.secondsPerQuestion })}{o.examName ? ` · ${L(o.examName.en, o.examName.hi)}` : ''}</AppText>
        </View>
        <View style={styles.sword}><Ionicons name="flash" size={18} color="#1F2937" /></View>
      </View>
      <View style={styles.stakes}>
        <View style={styles.stake}>
          <AppText size={11} color="rgba(255,255,255,0.6)">{t('coinDuels.entry')}</AppText>
          <View style={styles.coinRow}><Coin size={16} /><AppText weight="extrabold" size={20} color="#FFFFFF">{o.entryCoins}</AppText></View>
        </View>
        <Ionicons name="swap-horizontal" size={18} color="rgba(255,255,255,0.35)" />
        <View style={styles.stake}>
          <AppText size={11} color="rgba(255,255,255,0.6)">{t('coinDuels.prize')}</AppText>
          <View style={styles.coinRow}><Coin size={16} /><AppText weight="extrabold" size={20} color={palette.green}>{o.prizeCoins}</AppText></View>
        </View>
      </View>
      <View style={styles.meta}>
        <AppText size={11} color="rgba(255,255,255,0.6)">{t('coinDuels.openRooms', { n: o.openRooms })} · {t('coinDuels.waitingRooms', { n: o.waitingRooms })}</AppText>
      </View>
      {!o.eligible ? (
        <AppText size={12} color="#FCA5A5">{L(o.ineligibleReasonEn, o.ineligibleReasonHi) ?? t('coinDuels.notEligible')}</AppText>
      ) : resume ? (
        <Button title={t('coinDuels.inRoom')} variant="light" onPress={() => onJoin(o)} />
      ) : (
        <>
          <Button title={full ? t('coinDuels.full') : busy ? t('coinDuels.joining') : t('coinDuels.join', { coins: o.entryCoins })} disabled={full || !canAfford || busy} onPress={() => onJoin(o)} />
          {!canAfford && <AppText size={12} color="#FCD34D">{t('coinDuels.needCoins', { coins: o.entryCoins })}</AppText>}
        </>
      )}
    </Animated.View>
  );
}

/** Admin-created coin duels. The app only names the duel it wants; amounts, eligibility and results all come from the server. */
export function CoinDuels() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const wallet = useWallet();
  const [busyId, setBusyId] = useState<string | null>(null);
  const offers = useQuery({ queryKey: ['paid-duels'], queryFn: () => api<PaidDuelOfferDto[]>('/v1/duels/paid'), refetchInterval: 8000 });
  const { config } = useSession();
  const source = config?.['duels.paid']?.entrySource ?? 'EARNED_ONLY';
  // Only a hint for the button: the server decides which coins may pay and re-checks everything on join.
  const balance = source === 'EARNED_ONLY' ? wallet.data?.wallet.earned ?? 0 : wallet.data?.wallet.available ?? 0;

  async function join(o: PaidDuelOfferDto) {
    if (o.myRoom) {
      router.push({ pathname: '/duels/play', params: { paid: '1', room: o.myRoom.id, entry: String(o.entryCoins), prize: String(o.prizeCoins) } });
      return;
    }
    setBusyId(o.id);
    try {
      const r = await api<{ roomId: string; status: string }>(`/v1/duels/paid/offers/${o.id}/join`, { method: 'POST' });
      void qc.invalidateQueries({ queryKey: ['wallet'] });
      void qc.invalidateQueries({ queryKey: ['paid-duels'] });
      router.push({ pathname: '/duels/play', params: { paid: '1', room: r.roomId, entry: String(o.entryCoins), prize: String(o.prizeCoins) } });
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 12, gap: 14, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={offers.isRefetching} onRefresh={() => { void offers.refetch(); void wallet.refetch(); }} tintColor="#FFFFFF" />}>
      <View style={styles.balance}>
        <Coin size={20} />
        <AppText weight="bold" size={14} color="#FFFFFF" style={{ flex: 1 }}>{t('coinDuels.balance', { coins: balance })}</AppText>
        <AppText weight="bold" size={12} color={palette.amber} onPress={() => router.push('/wallet')}>{t('coinDuels.earn')} ›</AppText>
      </View>
      <AppText size={12} theme={arena} muted>{t('coinDuels.rules')}</AppText>
      {offers.isLoading ? <Loading theme={arena} /> : !offers.data?.length ? (
        <StateView theme={arena} icon="flash-outline" title={t('coinDuels.none')} />
      ) : offers.data.map((o, i) => <OfferCard key={o.id} o={o} index={i} balance={balance} onJoin={join} busy={busyId === o.id} />)}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  balance: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radius.md, backgroundColor: '#16244D', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  card: { padding: 16, gap: 12, borderRadius: radius.lg, backgroundColor: '#0F1B3D', borderWidth: 1, borderColor: 'rgba(245,158,11,0.25)' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sword: { width: 36, height: 36, borderRadius: 18, backgroundColor: palette.amber, alignItems: 'center', justifyContent: 'center' },
  stakes: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingVertical: 10, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.04)' },
  stake: { alignItems: 'center', gap: 2 },
  coinRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: { flexDirection: 'row', justifyContent: 'space-between' },
});
export { Coin };
