import { formatRupees, type CheckoutDto, type CoinPackDto } from '@testwise/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { CheckoutSheet } from '../../components/Checkout';
import { Header } from '../../components/Header';
import { AppText, Button, ErrorState, Loading, Pill, Screen, StateView } from '../../components/ui';
import { CoinIcon, fmtCoins, useCoinName, useWallet } from '../../components/Wallet';
import { api, ApiError } from '../../lib/api';
import { newKey, useLocalized } from '../../lib/format';
import { palette, radius } from '../../theme/tokens';

export default function TopUp() {
  const { t } = useTranslation();
  const L = useLocalized();
  const qc = useQueryClient();
  const coinName = useCoinName();
  const w = useWallet();
  const packs = useQuery({ queryKey: ['coin-packs'], queryFn: () => api<CoinPackDto[]>('/v1/wallet/packs') });
  const [selected, setSelected] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<CheckoutDto | null>(null);
  const [busy, setBusy] = useState(false);
  // One idempotency key per selected pack, so double taps never create two orders.
  const [key, setKey] = useState(newKey());

  const pack = packs.data?.find((p) => p.id === selected) ?? null;

  async function buy() {
    if (!pack) return;
    setBusy(true);
    try {
      const c = await api<CheckoutDto>('/v1/wallet/topup', { method: 'POST', body: { packId: pack.id, idempotencyKey: key } });
      if (c.completed) done();
      else setCheckout(c);
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function done() {
    setCheckout(null);
    void qc.invalidateQueries({ queryKey: ['wallet'] });
    void qc.invalidateQueries({ queryKey: ['wallet-txns'] });
    Alert.alert(t('wallet.toppedUp'), t('wallet.toppedUpBody', { coins: pack ? fmtCoins(pack.coins + pack.bonusCoins) : '', coin: coinName }));
    router.back();
  }

  return (
    <Screen>
      <Header title={t('wallet.topUpTitle', { coin: coinName })} fallback="/wallet" />
      {packs.isLoading ? <Loading /> : packs.error ? <ErrorState error={packs.error} onRetry={packs.refetch} /> : !packs.data?.length ? (
        <StateView icon="cart-outline" title={t('wallet.noPacks')} />
      ) : (
        <>
          <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 4, gap: 12, paddingBottom: 140 }}>
            {w.data && <AppText size={13} muted>{t('wallet.currentBalance', { coins: fmtCoins(w.data.wallet.available), coin: coinName })}</AppText>}
            {packs.data.map((p) => {
              const on = p.id === selected;
              return (
                <Pressable key={p.id} onPress={() => { setSelected(p.id); setKey(newKey()); }} style={[styles.pack, on && styles.packOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                  <CoinIcon size={40} />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <AppText weight="extrabold" size={18}>{fmtCoins(p.coins)}</AppText>
                      {p.bonusCoins > 0 && <AppText weight="bold" size={13} color={palette.green}>+{fmtCoins(p.bonusCoins)} {t('wallet.bonus')}</AppText>}
                    </View>
                    <AppText size={12} muted>{L(p.titleEn, p.titleHi)}</AppText>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    {p.badgeEn && <Pill label={L(p.badgeEn, p.badgeHi) ?? ''} />}
                    <AppText weight="extrabold" size={17}>{formatRupees(p.pricePaise)}</AppText>
                  </View>
                </Pressable>
              );
            })}
            <AppText size={12} muted style={{ marginTop: 8 }}>{t('wallet.topUpNote')}</AppText>
          </ScrollView>
          <View style={styles.footer}>
            <Button title={pack ? t('wallet.pay', { amount: formatRupees(pack.pricePaise) }) : t('wallet.choosePack')} onPress={buy} disabled={!pack || w.data?.wallet.frozen} loading={busy} />
          </View>
        </>
      )}
      <CheckoutSheet checkout={checkout} onClose={() => setCheckout(null)} onPaid={done} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  pack: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: radius.lg, borderWidth: 2, borderColor: '#EEF0F3', backgroundColor: '#FFFFFF' },
  packOn: { borderColor: palette.amber, backgroundColor: '#FFFBEB' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#EEF0F3' },
});
