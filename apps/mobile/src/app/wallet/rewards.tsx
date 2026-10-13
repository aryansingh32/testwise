import { Ionicons } from '@expo/vector-icons';
import { REWARD_KIND_INFO, type RewardKind } from '@testwise/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Image, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Header } from '../../components/Header';
import { AppText, Chip, ErrorState, Loading, Screen, StateView } from '../../components/ui';
import { CoinIcon, fmtCoins, useRewards, useWallet } from '../../components/Wallet';
import { useLocalized } from '../../lib/format';
import { useSession } from '../../lib/session';
import { palette, radius } from '../../theme/tokens';

export default function Rewards() {
  const { t } = useTranslation();
  const L = useLocalized();
  const { language } = useSession();
  const q = useRewards();
  const w = useWallet();
  const [kind, setKind] = useState<RewardKind | null>(null);
  const kinds = [...new Set((q.data ?? []).map((r) => r.kind))];
  const rows = (q.data ?? []).filter((r) => !kind || r.kind === kind);

  return (
    <Screen>
      <Header title={t('wallet.rewards')} fallback="/wallet" />
      {w.data && (
        <View style={styles.balance}>
          <CoinIcon />
          <AppText weight="bold" size={14}>{fmtCoins(w.data.wallet.available)}</AppText>
          <AppText size={12} muted>· {t('wallet.earnedShort', { coins: fmtCoins(w.data.wallet.earned) })}</AppText>
        </View>
      )}
      {kinds.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 20, paddingBottom: 8 }} style={{ flexGrow: 0 }}>
          <Chip label={t('wallet.all')} active={!kind} onPress={() => setKind(null)} />
          {kinds.map((k) => <Chip key={k} label={language === 'HI' ? REWARD_KIND_INFO[k].labelHi : REWARD_KIND_INFO[k].labelEn} active={kind === k} onPress={() => setKind(k)} />)}
        </ScrollView>
      )}
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          numColumns={2}
          columnWrapperStyle={{ gap: 12 }}
          contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 12, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={q.refetch} tintColor={palette.amber} />}
          ListEmptyComponent={<StateView icon="gift-outline" title={t('wallet.noRewards')} />}
          renderItem={({ item: r }) => {
            const affordable = w.data ? (r.allowPurchasedCoins ? w.data.wallet.available : w.data.wallet.earned) >= r.coinCost : true;
            return (
              <Pressable style={[styles.card, !r.inStock && { opacity: 0.5 }]} onPress={() => router.push({ pathname: '/wallet/reward/[id]', params: { id: r.id } })} accessibilityRole="button">
                <View style={styles.image}>
                  {r.imageUrl ? <Image source={{ uri: r.imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <Ionicons name={REWARD_KIND_INFO[r.kind].icon as never} size={40} color={palette.amberDark} />}
                  {!r.inStock && <View style={styles.soldOut}><AppText weight="bold" size={11} color="#FFFFFF">{t('wallet.soldOut')}</AppText></View>}
                </View>
                <View style={{ padding: 10, gap: 4 }}>
                  <AppText weight="bold" size={13} numberOfLines={2}>{L(r.titleEn, r.titleHi)}</AppText>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <CoinIcon size={14} />
                    <AppText weight="extrabold" size={14} color={affordable ? palette.ink : palette.red}>{fmtCoins(r.coinCost)}</AppText>
                  </View>
                  {!r.allowPurchasedCoins && <AppText size={10} color={palette.violet}>{t('wallet.earnedOnly')}</AppText>}
                  {r.stockLeft !== null && r.inStock && r.stockLeft <= 10 && <AppText size={10} color={palette.red}>{t('wallet.left', { count: r.stockLeft })}</AppText>}
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  balance: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingBottom: 10 },
  card: { flex: 1, maxWidth: '50%', borderRadius: radius.md, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#EEF0F3', overflow: 'hidden' },
  image: { height: 110, backgroundColor: '#FFFBEB', alignItems: 'center', justifyContent: 'center' },
  soldOut: { position: 'absolute', top: 8, left: 8, backgroundColor: palette.red, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
});
