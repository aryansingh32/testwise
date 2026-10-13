import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { palette } from '../theme/tokens';
import { AppText, light, type arena } from './ui';

/** Back-button header for pushed screens. */
export function Header({ title, right, theme = light, fallback = '/home' }: { title: string; right?: ReactNode; theme?: typeof light | typeof arena; fallback?: string }) {
  const { t } = useTranslation();
  const dark = theme.name === 'arena';
  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback as never))}
        style={[styles.back, { backgroundColor: dark ? 'rgba(255,255,255,0.1)' : '#F6F7F9' }]}
        hitSlop={8}
        accessibilityLabel={t('common.back')}
      >
        <Ionicons name="chevron-back" size={22} color={dark ? '#FFFFFF' : palette.ink} />
      </Pressable>
      <AppText weight="extrabold" size={18} theme={theme} numberOfLines={1} style={{ flex: 1 }}>{title}</AppText>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 10 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
