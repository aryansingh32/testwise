import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, useWindowDimensions, View, type ViewToken } from 'react-native';
import { AppText, Avatar, Button, Screen, arena } from '../../components/ui';
import { useSession } from '../../lib/session';
import { palette } from '../../theme/tokens';

const SLIDES = [
  { key: '1', icon: 'flash' as const, title: 'intro.slide1Title', body: 'intro.slide1Body' },
  { key: '2', icon: 'shield-checkmark' as const, title: 'intro.slide2Title', body: 'intro.slide2Body' },
  { key: '3', icon: 'language' as const, title: 'intro.slide3Title', body: 'intro.slide3Body' },
];

function Hero({ index }: { index: number }) {
  if (index === 0) {
    // Matchmaking-style orbit from the battle reference.
    return (
      <View style={styles.hero}>
        <View style={[styles.ring, { width: 240, height: 240 }]} />
        <View style={[styles.ring, { width: 170, height: 170 }]} />
        <Avatar name="You" size={86} ring={0} />
        <View style={{ position: 'absolute', top: 18, right: 40 }}><Avatar name="Charmie K" size={52} ring={1} /></View>
        <View style={{ position: 'absolute', bottom: 22, left: 34 }}><Avatar name="Rohan D" size={48} ring={3} /></View>
        <View style={{ position: 'absolute', bottom: 54, right: 18 }}><Avatar name="Iram S" size={42} ring={2} /></View>
      </View>
    );
  }
  return (
    <View style={styles.hero}>
      <View style={[styles.ring, { width: 220, height: 220 }]} />
      <View style={styles.heroIcon}>
        <Ionicons name={SLIDES[index].icon} size={56} color={palette.amber} />
      </View>
    </View>
  );
}

export default function Intro() {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const { language, setLanguage } = useSession();
  const [index, setIndex] = useState(0);
  const list = useRef<FlatList>(null);
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems[0]?.index != null) setIndex(viewableItems[0].index);
  }).current;

  return (
    <Screen theme={arena} edges={['top', 'bottom']}>
      <View style={styles.top}>
        <AppText weight="extrabold" size={20} color="#FFFFFF">
          Test<AppText weight="extrabold" size={20} color={palette.amber}>wise</AppText>
        </AppText>
        <Pressable onPress={() => setLanguage(language === 'EN' ? 'HI' : 'EN')} style={styles.lang} accessibilityRole="button">
          <Ionicons name="language" size={14} color="#FFFFFF" />
          <AppText weight="bold" size={12} color="#FFFFFF">{language === 'EN' ? 'हिन्दी' : 'English'}</AppText>
        </Pressable>
      </View>

      <FlatList
        ref={list}
        data={SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        renderItem={({ item, index: i }) => (
          <View style={{ width, paddingHorizontal: 28, justifyContent: 'center' }}>
            <Hero index={i} />
            <AppText weight="extrabold" size={28} color="#FFFFFF" style={{ textAlign: 'center', marginTop: 28 }}>
              {t(item.title)}
            </AppText>
            <AppText size={15} color="rgba(255,255,255,0.7)" style={{ textAlign: 'center', marginTop: 10 }}>
              {t(item.body)}
            </AppText>
          </View>
        )}
      />

      <View style={styles.dots}>
        {SLIDES.map((s, i) => (
          <View key={s.key} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>

      <View style={{ paddingHorizontal: 24, gap: 12, paddingBottom: 12 }}>
        <Button
          title={index < SLIDES.length - 1 ? t('common.continue') : t('intro.getStarted')}
          onPress={() => (index < SLIDES.length - 1 ? list.current?.scrollToIndex({ index: index + 1 }) : router.push('/register'))}
        />
        <Button title={t('intro.haveAccount')} variant="ghost" onPress={() => router.push('/login')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingTop: 8 },
  lang: { flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  hero: { height: 260, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', borderRadius: 999, borderWidth: 1, borderColor: 'rgba(96,165,250,0.25)' },
  heroIcon: { width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(245,158,11,0.12)', alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginVertical: 20 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.25)' },
  dotActive: { width: 24, backgroundColor: palette.amber },
});
