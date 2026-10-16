import { Ionicons } from '@expo/vector-icons';
import { type SeriesCardDto } from '@testwise/shared';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { useLocalized } from '../lib/format';
import { palette, radius } from '../theme/tokens';
import { AppText, Pill } from './ui';
import { useCoinPrice } from './Wallet';

export function SeriesCard({ s }: { s: SeriesCardDto }) {
  const { t } = useTranslation();
  const L = useLocalized();
  const price = useCoinPrice();
  return (
    <Pressable onPress={() => router.push({ pathname: '/series/[slug]', params: { slug: s.slug } })} style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]} accessibilityRole="button">
      <View style={[styles.cover, { backgroundColor: s.color }]}>
        <View style={styles.coverCircle} />
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {s.badgeEn && <Pill label={L(s.badgeEn, s.badgeHi) ?? ''} color="rgba(255,255,255,0.25)" />}
          {s.enrolled && <Pill label={t('store.enrolled')} color={palette.green} icon="checkmark" />}
        </View>
        <AppText weight="extrabold" size={20} color="#FFFFFF" numberOfLines={2} style={{ marginTop: 'auto' }}>{L(s.titleEn, s.titleHi)}</AppText>
      </View>
      <View style={styles.cardBody}>
        <View style={{ flex: 1 }}>
          <AppText size={12} muted>{[s.examName ? L(s.examName.en, s.examName.hi) : null, t('store.tests', { count: s.testCount })].filter(Boolean).join(' · ')}</AppText>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
            <AppText weight="extrabold" size={20}>{s.pricePaise ? price(s.pricePaise) : t('common.free')}</AppText>
            {s.mrpPaise && s.mrpPaise > s.pricePaise ? <AppText size={12} color="#9CA3AF" style={{ textDecorationLine: 'line-through' }}>{price(s.mrpPaise)}</AppText> : null}
          </View>
        </View>
        <Ionicons name="arrow-forward-circle" size={32} color={palette.amber} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.xl, overflow: 'hidden', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#F1F2F4', shadowColor: '#0F172A', shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  cover: { height: 150, padding: 18, overflow: 'hidden' },
  coverCircle: { position: 'absolute', right: -40, top: -40, width: 170, height: 170, borderRadius: 85, backgroundColor: 'rgba(255,255,255,0.15)' },
  cardBody: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
});
