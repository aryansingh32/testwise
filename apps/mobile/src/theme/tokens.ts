/**
 * Design tokens. `light` is the learning/store look from the reference UI;
 * `arena` is the dark navy competitive mode (tournaments, duels, results).
 */
export const palette = {
  amber: '#F59E0B',
  amberDark: '#D97706',
  green: '#10B981',
  blue: '#3B82F6',
  violet: '#8B5CF6',
  red: '#EF4444',
  ink: '#1F2937',
  white: '#FFFFFF',
} as const;

export interface Theme {
  name: 'light' | 'arena';
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  primary: string;
  primaryText: string;
  success: string;
  info: string;
  danger: string;
  gradient: [string, string];
}

export const light: Theme = {
  name: 'light',
  bg: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceAlt: '#F6F7F9',
  border: '#EEF0F3',
  text: palette.ink,
  textMuted: '#6B7280',
  textFaint: '#9CA3AF',
  primary: palette.amber,
  primaryText: '#FFFFFF',
  success: palette.green,
  info: palette.blue,
  danger: palette.red,
  gradient: ['#FFFFFF', '#FFFFFF'],
};

export const arena: Theme = {
  name: 'arena',
  bg: '#050A1A',
  surface: '#0F1B3D',
  surfaceAlt: '#16244D',
  border: 'rgba(255,255,255,0.08)',
  text: '#FFFFFF',
  textMuted: 'rgba(255,255,255,0.65)',
  textFaint: 'rgba(255,255,255,0.4)',
  primary: palette.amber,
  primaryText: '#1F2937',
  success: '#34D399',
  info: '#60A5FA',
  danger: '#F87171',
  gradient: ['#0B1530', '#050A1A'],
};

export const radius = { sm: 10, md: 16, lg: 24, xl: 32, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

export const fonts = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
  hindi: 'NotoSansDevanagari_400Regular',
  hindiBold: 'NotoSansDevanagari_700Bold',
} as const;

/** Rank-tier ring colours for avatars in Arena mode (matches the battle reference). */
export const ringColors = ['#F97316', '#EC4899', '#8B5CF6', '#FACC15', '#22D3EE'] as const;
