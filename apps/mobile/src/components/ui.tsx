import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { forwardRef, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useSession } from '../lib/session';
import { arena, fonts, light, palette, radius, ringColors, type Theme } from '../theme/tokens';

export type Weight = 'regular' | 'medium' | 'semibold' | 'bold' | 'extrabold';

/** Font family for the current language: Devanagari font for Hindi (it includes Latin glyphs). */
export function useFont() {
  const { language } = useSession();
  return (weight: Weight = 'regular') =>
    language === 'HI' ? (weight === 'regular' || weight === 'medium' ? fonts.hindi : fonts.hindiBold) : fonts[weight];
}

export function AppText({
  weight = 'regular',
  size = 14,
  color,
  theme = light,
  muted,
  style,
  ...props
}: TextProps & { weight?: Weight; size?: number; color?: string; theme?: Theme; muted?: boolean }) {
  const font = useFont();
  return (
    <Text
      {...props}
      style={[
        { fontFamily: font(weight), fontSize: size, color: color ?? (muted ? theme.textMuted : theme.text), lineHeight: Math.round(size * 1.4) },
        style,
      ]}
    />
  );
}

export function Screen({
  children,
  theme = light,
  edges = ['top'],
  style,
}: {
  children: ReactNode;
  theme?: Theme;
  edges?: Edge[];
  style?: StyleProp<ViewStyle>;
}) {
  if (theme.name === 'arena') {
    return (
      <LinearGradient colors={theme.gradient} style={{ flex: 1 }}>
        <SafeAreaView edges={edges} style={[{ flex: 1 }, style]}>
          {children}
        </SafeAreaView>
      </LinearGradient>
    );
  }
  return (
    <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: theme.bg }, style]}>
      {children}
    </SafeAreaView>
  );
}

type ButtonVariant = 'primary' | 'dark' | 'secondary' | 'ghost' | 'light';

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  icon,
  style,
  size = 'lg',
}: {
  title: string;
  onPress?: PressableProps['onPress'];
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: ComponentProps<typeof Ionicons>['name'];
  style?: StyleProp<ViewStyle>;
  size?: 'md' | 'lg';
}) {
  const bg = { primary: palette.amber, dark: palette.ink, secondary: '#F3F4F6', ghost: 'transparent', light: '#FFFFFF' }[variant];
  const fg = { primary: '#FFFFFF', dark: '#FFFFFF', secondary: palette.ink, ghost: palette.amber, light: palette.ink }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, height: size === 'lg' ? 54 : 42, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
        variant === 'primary' && styles.primaryShadow,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={18} color={fg} />}
          <AppText weight="bold" size={size === 'lg' ? 15 : 13} color={fg}>
            {title}
          </AppText>
        </>
      )}
    </Pressable>
  );
}

export const Input = forwardRef<TextInput, TextInputProps & { label: string; hint?: string; error?: string; icon?: ComponentProps<typeof Ionicons>['name'] }>(
  function Input({ label, hint, error, icon, style, ...props }, ref) {
    const font = useFont();
    return (
      <View style={{ gap: 6 }}>
        <AppText weight="semibold" size={12} muted>
          {label}
        </AppText>
        <View style={[styles.inputWrap, error ? { borderColor: palette.red } : null]}>
          {icon && <Ionicons name={icon} size={18} color="#9CA3AF" />}
          <TextInput
            ref={ref}
            placeholderTextColor="#9CA3AF"
            {...props}
            style={[{ flex: 1, fontFamily: font('medium'), fontSize: 15, color: palette.ink, paddingVertical: 14 }, Platform.OS === 'web' && ({ outlineStyle: 'none' } as unknown as TextStyle), style as StyleProp<TextStyle>]}
          />
        </View>
        {(error || hint) && (
          <AppText size={12} color={error ? palette.red : '#9CA3AF'}>
            {error ?? hint}
          </AppText>
        )}
      </View>
    );
  },
);

export function Card({ children, style, theme = light }: { children: ReactNode; style?: StyleProp<ViewStyle>; theme?: Theme }) {
  return (
    <View
      style={[
        styles.card,
        theme.name === 'arena' ? { backgroundColor: theme.surface, borderColor: theme.border } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
  theme = light,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  theme?: Theme;
}) {
  const isArena = theme.name === 'arena';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={[
        styles.chip,
        { backgroundColor: active ? palette.amber : isArena ? 'rgba(255,255,255,0.08)' : '#F3F4F6' },
      ]}
    >
      <AppText weight="bold" size={12} color={active ? '#FFFFFF' : isArena ? theme.textMuted : '#6B7280'}>
        {label}
      </AppText>
    </Pressable>
  );
}

export function Pill({ label, color = palette.amber, textColor = '#FFFFFF', icon }: { label: string; color?: string; textColor?: string; icon?: ComponentProps<typeof Ionicons>['name'] }) {
  return (
    <View style={[styles.pill, { backgroundColor: color }]}>
      {icon && <Ionicons name={icon} size={11} color={textColor} />}
      <AppText weight="extrabold" size={10} color={textColor} style={{ letterSpacing: 0.5, textTransform: 'uppercase' }}>
        {label}
      </AppText>
    </View>
  );
}

export function SectionHeader({ title, action, onAction, theme = light }: { title: string; action?: string; onAction?: () => void; theme?: Theme }) {
  return (
    <View style={styles.sectionHeader}>
      <AppText weight="bold" size={18} theme={theme}>
        {title}
      </AppText>
      {action && (
        <Pressable onPress={onAction} hitSlop={8}>
          <AppText weight="bold" size={13} color={palette.amber}>
            {action} ›
          </AppText>
        </Pressable>
      )}
    </View>
  );
}

export function Avatar({ name, size = 44, ring = 0, uri: _uri }: { name: string; size?: number; ring?: number; uri?: string | null }) {
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const color = ringColors[ring % ringColors.length];
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 3, borderColor: color, padding: 2 }}>
      <View style={{ flex: 1, borderRadius: size, backgroundColor: '#1E293B', alignItems: 'center', justifyContent: 'center' }}>
        <AppText weight="extrabold" size={size * 0.32} color="#FFFFFF">
          {initials}
        </AppText>
      </View>
    </View>
  );
}

export function StateView({
  icon = 'cloud-offline-outline',
  title,
  body,
  action,
  onAction,
  theme = light,
}: {
  icon?: ComponentProps<typeof Ionicons>['name'];
  title: string;
  body?: string;
  action?: string;
  onAction?: () => void;
  theme?: Theme;
}) {
  return (
    <View style={styles.state}>
      <View style={[styles.stateIcon, { backgroundColor: theme.name === 'arena' ? 'rgba(255,255,255,0.06)' : '#FFF9F0' }]}>
        <Ionicons name={icon} size={30} color={palette.amber} />
      </View>
      <AppText weight="bold" size={17} theme={theme} style={{ textAlign: 'center' }}>
        {title}
      </AppText>
      {body && (
        <AppText size={13} muted theme={theme} style={{ textAlign: 'center', maxWidth: 300 }}>
          {body}
        </AppText>
      )}
      {action && <Button title={action} onPress={onAction} size="md" style={{ marginTop: 8, paddingHorizontal: 24 }} />}
    </View>
  );
}

export function ErrorState({ error, onRetry, theme }: { error: unknown; onRetry?: () => void; theme?: Theme }) {
  const { t } = useTranslation();
  const offline = (error as { status?: number })?.status === 0;
  return (
    <StateView
      theme={theme}
      icon={offline ? 'cloud-offline-outline' : 'alert-circle-outline'}
      title={offline ? t('common.offline') : t('common.error')}
      body={offline ? undefined : (error as Error)?.message}
      action={onRetry ? t('common.retry') : undefined}
      onAction={onRetry}
    />
  );
}

export function Loading({ theme = light }: { theme?: Theme }) {
  return (
    <View style={[styles.state, { flex: 1 }]}>
      <ActivityIndicator color={theme.name === 'arena' ? '#FFFFFF' : palette.amber} />
    </View>
  );
}

export { arena, light };

const styles = StyleSheet.create({
  button: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
  },
  primaryShadow: {
    shadowColor: palette.amber,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F6F7F9',
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: 'transparent',
    paddingHorizontal: 14,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#F1F2F4',
    padding: 16,
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 1,
  },
  chip: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: radius.sm + 2 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  state: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  stateIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
});
