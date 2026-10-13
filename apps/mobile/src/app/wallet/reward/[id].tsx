import { Ionicons } from '@expo/vector-icons';
import { formatRupees, REWARD_KIND_INFO, shippingAddressSchema, upiVpaSchema, type RedemptionDto, type ShippingAddress } from '@testwise/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Header } from '../../../components/Header';
import { AppText, Button, Chip, ErrorState, Input, Loading, Screen } from '../../../components/ui';
import { CoinIcon, fmtCoins, useCoinName, useRewards, useWallet } from '../../../components/Wallet';
import { api, ApiError } from '../../../lib/api';
import { newKey, useLocalized } from '../../../lib/format';
import { useSession } from '../../../lib/session';
import { palette, radius } from '../../../theme/tokens';

const EMPTY: ShippingAddress = { name: '', phone: '', line1: '', line2: '', city: '', state: '', pincode: '' };

export default function RewardDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const L = useLocalized();
  const { user, language } = useSession();
  const qc = useQueryClient();
  const coinName = useCoinName();
  const rewards = useRewards();
  const w = useWallet();
  const r = rewards.data?.find((x) => x.id === id);
  const [variant, setVariant] = useState<string | null>(null);
  const [address, setAddress] = useState<ShippingAddress>({ ...EMPTY, name: user?.displayName ?? '' });
  const [upi, setUpi] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // Stable per visit: retrying after a network error never redeems twice.
  const [key] = useState(newKey());

  const split = useMemo(() => {
    if (!r || !w.data) return null;
    const { purchased, earned } = w.data.wallet;
    const fromPurchased = r.allowPurchasedCoins ? Math.min(purchased, r.coinCost) : 0;
    const fromEarned = r.coinCost - fromPurchased;
    return { fromPurchased, fromEarned, enough: fromEarned <= earned };
  }, [r, w.data]);

  if (rewards.isLoading || w.isLoading) return <Screen><Header title="" fallback="/wallet/rewards" /><Loading /></Screen>;
  if (!r) return <Screen><Header title="" fallback="/wallet/rewards" /><ErrorState error={rewards.error ?? new Error(t('wallet.notFound'))} onRetry={rewards.refetch} /></Screen>;

  const setA = (k: keyof ShippingAddress, v: string) => setAddress((a) => ({ ...a, [k]: v }));

  function validate() {
    const e: Record<string, string> = {};
    if (r!.variants.length && !variant) e.variant = t('wallet.pickVariant');
    if (r!.requiresAddress) {
      const res = shippingAddressSchema.safeParse({ ...address, line2: address.line2 || null });
      const msg: Record<string, string> = { phone: t('wallet.err.phone'), pincode: t('wallet.err.pincode') };
      if (!res.success) for (const i of res.error.issues) e[String(i.path[0])] = msg[String(i.path[0])] ?? t('wallet.err.required');
    }
    if (r!.requiresUpi && !upiVpaSchema.safeParse(upi).success) e.upi = t('wallet.badUpi');
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function redeem() {
    if (!validate()) return;
    setBusy(true);
    try {
      const res = await api<RedemptionDto>('/v1/wallet/redeem', {
        method: 'POST',
        body: {
          rewardId: r!.id, idempotencyKey: key, variant,
          shippingAddress: r!.requiresAddress ? { ...address, line2: address.line2 || null } : null,
          upiVpa: r!.requiresUpi ? upi.trim().toLowerCase() : null,
        },
      });
      void qc.invalidateQueries({ queryKey: ['wallet'] });
      void qc.invalidateQueries({ queryKey: ['wallet-txns'] });
      void qc.invalidateQueries({ queryKey: ['rewards'] });
      void qc.invalidateQueries({ queryKey: ['redemptions'] });
      Alert.alert(
        res.status === 'FULFILLED' ? t('wallet.delivered') : t('wallet.requested'),
        res.status === 'FULFILLED' ? t('wallet.deliveredBody') : t('wallet.requestedBody', { coins: fmtCoins(res.coins), coin: coinName }),
      );
      router.replace('/wallet/redemptions');
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const kind = REWARD_KIND_INFO[r.kind];
  return (
    <Screen>
      <Header title={L(r.titleEn, r.titleHi) ?? ''} fallback="/wallet/rewards" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 4, gap: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            {r.imageUrl ? <Image source={{ uri: r.imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <Ionicons name={kind.icon as never} size={64} color={palette.amberDark} />}
          </View>
          <View style={{ gap: 6 }}>
            <AppText size={12} weight="bold" color={palette.amberDark}>{(language === 'HI' ? kind.labelHi : kind.labelEn).toUpperCase()}{r.brand ? ` · ${r.brand}` : ''}</AppText>
            <AppText weight="extrabold" size={22}>{L(r.titleEn, r.titleHi)}</AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <CoinIcon size={20} />
              <AppText weight="extrabold" size={20}>{fmtCoins(r.coinCost)}</AppText>
              {r.valuePaise > 0 && <AppText size={13} muted>· {t('wallet.worth', { amount: formatRupees(r.valuePaise) })}</AppText>}
            </View>
            {(r.descriptionEn || r.descriptionHi) && <AppText size={14} muted style={{ lineHeight: 21 }}>{L(r.descriptionEn, r.descriptionHi)}</AppText>}
          </View>

          {r.variants.length > 0 && (
            <View style={{ gap: 8 }}>
              <AppText weight="semibold" size={12} muted>{t('wallet.size')}</AppText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {r.variants.map((v) => <Chip key={v} label={v} active={variant === v} onPress={() => setVariant(v)} />)}
              </View>
              {errors.variant && <AppText size={12} color={palette.red}>{errors.variant}</AppText>}
            </View>
          )}

          {r.requiresUpi && (
            <View style={{ gap: 8 }}>
              <Input label={t('wallet.upiId')} value={upi} onChangeText={setUpi} placeholder="name@okaxis" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" icon="at" error={errors.upi} hint={t('wallet.upiHint')} />
            </View>
          )}

          {r.requiresAddress && (
            <View style={{ gap: 12 }}>
              <AppText weight="bold" size={16}>{t('wallet.address')}</AppText>
              <Input label={t('wallet.addr.name')} value={address.name} onChangeText={(v) => setA('name', v)} error={errors.name} autoComplete="name" />
              <Input label={t('wallet.addr.phone')} value={address.phone} onChangeText={(v) => setA('phone', v.replace(/\D/g, '').slice(0, 10))} keyboardType="phone-pad" error={errors.phone} autoComplete="tel" />
              <Input label={t('wallet.addr.line1')} value={address.line1} onChangeText={(v) => setA('line1', v)} error={errors.line1} autoComplete="street-address" />
              <Input label={t('wallet.addr.line2')} value={address.line2 ?? ''} onChangeText={(v) => setA('line2', v)} />
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}><Input label={t('wallet.addr.city')} value={address.city} onChangeText={(v) => setA('city', v)} error={errors.city} /></View>
                <View style={{ flex: 1 }}><Input label={t('wallet.addr.pincode')} value={address.pincode} onChangeText={(v) => setA('pincode', v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" error={errors.pincode} autoComplete="postal-code" /></View>
              </View>
              <Input label={t('wallet.addr.state')} value={address.state} onChangeText={(v) => setA('state', v)} error={errors.state} />
            </View>
          )}

          {split && (
            <View style={styles.summary}>
              <Row k={t('wallet.fromPurchased')} v={fmtCoins(split.fromPurchased)} />
              <Row k={t('wallet.fromEarned')} v={fmtCoins(split.fromEarned)} />
              {!r.allowPurchasedCoins && <AppText size={12} color={palette.violet}>{t('wallet.earnedOnlyHint')}</AppText>}
              {!split.enough && <AppText size={12} color={palette.red}>{t('wallet.notEnough', { coin: coinName })}</AppText>}
            </View>
          )}
          {(r.termsEn || r.termsHi) && <AppText size={12} muted>{L(r.termsEn, r.termsHi)}</AppText>}
          <AppText size={12} muted>{r.requiresUpi ? t('wallet.upiReview') : t('wallet.holdNote')}</AppText>

          <Button
            title={!r.inStock ? t('wallet.soldOut') : t('wallet.redeemFor', { coins: fmtCoins(r.coinCost) })}
            onPress={redeem}
            loading={busy}
            disabled={!r.inStock || !split?.enough || w.data?.wallet.frozen}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <AppText size={13} muted>{k}</AppText>
      <AppText weight="bold" size={13}>{v}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { height: 200, borderRadius: radius.lg, backgroundColor: '#FFFBEB', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  summary: { gap: 6, padding: 14, borderRadius: radius.md, backgroundColor: '#F6F7F9' },
});
