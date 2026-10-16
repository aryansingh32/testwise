import { Ionicons } from '@expo/vector-icons';
import { type SeriesDetailDto } from '@testwise/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCoinPrice, usePurchaseError } from '../../components/Wallet';
import { TestCard } from '../../components/TestCard';
import { AppText, Button, ErrorState, Loading, Pill, Screen, useFont } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { formatDateTime, newKey, useLocalized } from '../../lib/format';
import { useSession } from '../../lib/session';
import { palette, radius } from '../../theme/tokens';

export default function SeriesDetail() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { t } = useTranslation();
  const L = useLocalized();
  const font = useFont();
  const { language } = useSession();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [coupon, setCoupon] = useState('');
  const [quote, setQuote] = useState<{ code: string; discountPaise: number; payablePaise: number; payableCoins: number; discountCoins: number } | null>(null);
  const coinPrice = useCoinPrice();
  const purchaseError = usePurchaseError();
  const [busy, setBusy] = useState(false);
  const { data: s, error, isLoading, refetch } = useQuery({ queryKey: ['series', slug], queryFn: () => api<SeriesDetailDto>(`/v1/store/series/${slug}`) });

  if (isLoading) return <Screen><Loading /></Screen>;
  if (error || !s) return <Screen><ErrorState error={error} onRetry={refetch} /></Screen>;

  const refresh = () => {
    void refetch();
    void qc.invalidateQueries({ queryKey: ['store'] });
    void qc.invalidateQueries({ queryKey: ['my-series'] });
    void qc.invalidateQueries({ queryKey: ['home'] });
  };

  async function applyCoupon() {
    try {
      const r = await api<{ discountPaise: number; payablePaise: number; payableCoins: number; discountCoins: number }>(`/v1/store/series/${slug}/quote?coupon=${encodeURIComponent(coupon.trim())}`);
      setQuote({ code: coupon.trim().toUpperCase(), ...r });
    } catch (e) {
      setQuote(null);
      Alert.alert(t('common.error'), e instanceof ApiError ? e.message : String(e));
    }
  }

  async function buy() {
    setBusy(true);
    try {
      await api<{ enrolled: boolean }>(`/v1/store/series/${slug}/purchase`, { method: 'POST', body: { idempotencyKey: newKey(), couponCode: quote?.code ?? null } });
      void qc.invalidateQueries({ queryKey: ['wallet'] });
      refresh();
    } catch (e) {
      purchaseError(e);
    } finally {
      setBusy(false);
    }
  }

  const price = quote ? quote.payablePaise : s.pricePaise;

  return (
    <Screen edges={[]}>
      <ScrollView contentContainerStyle={{ paddingBottom: (s.enrolled ? 40 : 130) + insets.bottom }}>
        <View style={[styles.hero, { backgroundColor: s.color, paddingTop: 56 + insets.top }]}>
          <View style={styles.heroCircle} />
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/store'))} style={[styles.back, { top: 12 + insets.top }]} accessibilityLabel={t('common.back')}>
            <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
          </Pressable>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {s.badgeEn && <Pill label={L(s.badgeEn, s.badgeHi) ?? ''} color="rgba(255,255,255,0.25)" />}
            {s.enrolled && <Pill label={t('store.enrolled')} color={palette.green} icon="checkmark" />}
          </View>
          <AppText weight="extrabold" size={26} color="#FFFFFF" style={{ marginTop: 10 }}>{L(s.titleEn, s.titleHi)}</AppText>
          <AppText size={13} color="rgba(255,255,255,0.85)" style={{ marginTop: 6 }}>
            {[t('store.tests', { count: s.tests.length }), t('store.validity', { days: s.validityDays }), s.enrolledCount ? t('store.studentsEnrolled', { count: s.enrolledCount }) : null].filter(Boolean).join(' · ')}
          </AppText>
        </View>

        <View style={{ padding: 20, gap: 18, maxWidth: 760, width: '100%', alignSelf: 'center' }}>
          {s.enrolledUntil && <AppText size={13} color={palette.green} weight="semibold">{t('store.enrolledUntil', { date: formatDateTime(s.enrolledUntil, language) })}</AppText>}
          {s.descriptionEn && <AppText size={14} muted>{L(s.descriptionEn, s.descriptionHi)}</AppText>}
          {s.features.length > 0 && (
            <View style={{ gap: 10 }}>
              <AppText weight="bold" size={17}>{t('store.highlights')}</AppText>
              {s.features.map((f, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                  <Ionicons name="checkmark-circle" size={18} color={palette.green} />
                  <AppText size={14} style={{ flex: 1 }}>{L(f.en, f.hi ?? null)}</AppText>
                </View>
              ))}
            </View>
          )}
          <AppText weight="bold" size={17}>{t('store.testsInside')}</AppText>
          {s.tests.map((test) => <TestCard key={test.id} test={test} />)}

          {!s.enrolled && s.pricePaise > 0 && (
            <View style={styles.coupon}>
              <TextInput value={coupon} onChangeText={setCoupon} autoCapitalize="characters" placeholder={t('store.coupon')} placeholderTextColor="#9CA3AF" style={{ flex: 1, fontFamily: font('semibold'), fontSize: 14, color: palette.ink, paddingVertical: 12 }} />
              <Pressable onPress={applyCoupon} disabled={!coupon.trim()} hitSlop={8}><AppText weight="bold" size={14} color={coupon.trim() ? palette.amber : '#9CA3AF'}>{t('store.apply')}</AppText></Pressable>
            </View>
          )}
          {quote && quote.discountPaise > 0 && <AppText size={13} color={palette.green} weight="semibold">{t('store.couponSaved', { amount: coinPrice(quote.discountPaise) })}</AppText>}
        </View>
      </ScrollView>

      {!s.enrolled && (
        <View style={[styles.footer, { paddingBottom: 16 + insets.bottom }]}>
          <View>
            <AppText weight="extrabold" size={22}>{price ? coinPrice(price) : t('common.free')}</AppText>
            {s.mrpPaise && s.mrpPaise > price ? <AppText size={12} color="#9CA3AF" style={{ textDecorationLine: 'line-through' }}>{coinPrice(s.mrpPaise)}</AppText> : null}
          </View>
          <Button title={s.pricePaise ? t('store.buy', { price: coinPrice(price) }) : t('store.unlockFree')} onPress={buy} loading={busy} style={{ flex: 1 }} />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: 20, paddingBottom: 24, overflow: 'hidden' },
  heroCircle: { position: 'absolute', right: -60, top: -40, width: 240, height: 240, borderRadius: 120, backgroundColor: 'rgba(255,255,255,0.15)' },
  back: { position: 'absolute', left: 16, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.2)', alignItems: 'center', justifyContent: 'center' },
  coupon: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderColor: '#EEF0F3', borderStyle: 'dashed', borderRadius: radius.md, paddingHorizontal: 14 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingTop: 14, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#F1F2F4' },
});
