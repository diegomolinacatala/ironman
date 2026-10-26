/**
 * Road to Ironman design tokens — "race-day hi-vis on ink & paper".
 *
 * - Light mode: warm paper background, ink text, hi-vis lime for the primary
 *   action and "today"/"together" highlights.
 * - Dark mode: deep ink background, warm off-white text, same lime.
 * - Sports are colour-coded consistently everywhere (cards, charts, widgets).
 * - Type: Barlow Condensed for display/numbers (race-bib feel), Barlow for text.
 */
import { useColorScheme } from 'react-native';

import type { Intensity, Sport } from '@/domain/types';

export const fonts = {
  display: 'BarlowCondensed_700Bold',
  displayHeavy: 'BarlowCondensed_800ExtraBold',
  displayItalic: 'BarlowCondensed_700Bold_Italic',
  displayMedium: 'BarlowCondensed_600SemiBold',
  body: 'Barlow_400Regular',
  bodyMedium: 'Barlow_500Medium',
  bodySemibold: 'Barlow_600SemiBold',
  bodyBold: 'Barlow_700Bold',
} as const;

export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 22,
  xl: 28,
  pill: 999,
} as const;

export const duration = {
  fast: 150,
  normal: 260,
  slow: 420,
} as const;

/** Text styles. Font families resolve once fonts are loaded in the root layout. */
export const type = {
  hero: { fontFamily: fonts.displayHeavy, fontSize: 56, lineHeight: 56, letterSpacing: -0.5 },
  display: { fontFamily: fonts.displayHeavy, fontSize: 40, lineHeight: 42, letterSpacing: -0.3 },
  title: { fontFamily: fonts.display, fontSize: 28, lineHeight: 32 },
  heading: { fontFamily: fonts.bodySemibold, fontSize: 19, lineHeight: 24 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 22 },
  bodyStrong: { fontFamily: fonts.bodySemibold, fontSize: 16, lineHeight: 22 },
  callout: { fontFamily: fonts.bodyMedium, fontSize: 15, lineHeight: 20 },
  caption: { fontFamily: fonts.bodyMedium, fontSize: 13, lineHeight: 18 },
  overline: { fontFamily: fonts.display, fontSize: 12, lineHeight: 14, letterSpacing: 1.4, textTransform: 'uppercase' },
  metric: { fontFamily: fonts.displayItalic, fontSize: 34, lineHeight: 36 },
  metricSmall: { fontFamily: fonts.displayItalic, fontSize: 22, lineHeight: 24 },
} as const;

export type TypeVariant = keyof typeof type;

const lime = '#D4FF3A';
const limeDeep = '#B8E61E';

const light = {
  scheme: 'light' as 'light' | 'dark',
  bg: '#F4F1EA',
  bgElevated: '#FBF9F5',
  surface: '#FFFFFF',
  surfaceAlt: '#ECE8DF',
  surfacePressed: '#E3DED3',
  border: '#DCD6CA',
  borderStrong: '#B9B2A4',
  text: '#15171A',
  textMuted: '#5E6066',
  textFaint: '#8C8E93',
  inverseBg: '#15171A',
  inverseText: '#F4F1EA',
  accent: lime,
  accentPressed: limeDeep,
  onAccent: '#15171A',
  /** Accent usable as text/icon on light backgrounds. */
  accentInk: '#4B6B00',
  success: '#1F9D5A',
  warning: '#C98A00',
  danger: '#D2392F',
  info: '#2F6FDB',
  overlay: 'rgba(21,23,26,0.45)',
  shadow: 'rgba(21,23,26,0.12)',
};

const dark: typeof light = {
  scheme: 'dark',
  bg: '#0D0F12',
  bgElevated: '#13161A',
  surface: '#171A1F',
  surfaceAlt: '#1F232A',
  surfacePressed: '#262B33',
  border: '#2A2F37',
  borderStrong: '#3B424D',
  text: '#F2EFE8',
  textMuted: '#A3A6AD',
  textFaint: '#6E727A',
  inverseBg: '#F2EFE8',
  inverseText: '#0D0F12',
  accent: lime,
  accentPressed: limeDeep,
  onAccent: '#0D0F12',
  accentInk: lime,
  success: '#3CCB7F',
  warning: '#F2B533',
  danger: '#FF5A4E',
  info: '#6EA2FF',
  overlay: 'rgba(0,0,0,0.6)',
  shadow: 'rgba(0,0,0,0.5)',
};

export type ThemeColors = typeof light;

/**
 * Sport colours (same hue in both schemes; `tint` is a soft background).
 * Green / yellow / orange / red are RESERVED for compliance states, so sports
 * use blue, violet, teal, magenta, slate and pink.
 */
export const sportColor: Record<Sport, { base: string; tint: string; tintDark: string }> = {
  swim: { base: '#2F7BEA', tint: '#DFEAFC', tintDark: '#10233F' },
  bike: { base: '#8A5CF6', tint: '#ECE4FE', tintDark: '#241A45' },
  run: { base: '#0FA3A0', tint: '#D8F3F2', tintDark: '#0B2E2E' },
  brick: { base: '#C04FD0', tint: '#F5E1F8', tintDark: '#341639' },
  strength: { base: '#5B6474', tint: '#E4E6EA', tintDark: '#1F232B' },
  mobility: { base: '#6C8CD5', tint: '#E3EAF8', tintDark: '#1A2338' },
  other: { base: '#E0559B', tint: '#FBE3EF', tintDark: '#3A1528' },
  rest: { base: '#9AA0A6', tint: '#ECEDEE', tintDark: '#22252A' },
};

/** Intensity scale colours (Z1 → race), cool → hot. */
export const intensityColor: Record<Intensity, string> = {
  recovery: '#9FB4C7',
  endurance: '#5B9BD5',
  tempo: '#8E7CC3',
  threshold: '#C55FA5',
  vo2: '#E0457B',
  race: '#B3125E',
};

/** Compliance states (TrainingPeaks convention). Always pair with an icon. */
export const complianceColor = {
  done: '#1F9D5A',
  partial: '#D9B200',
  off: '#EE7A1A',
  missed: '#D2392F',
  unplanned: '#9AA0A6',
  adjusted: '#6F8FA6',
} as const;
export type ComplianceState = keyof typeof complianceColor;

export interface Theme {
  colors: ThemeColors;
  isDark: boolean;
  sport: (s: Sport) => { base: string; tint: string };
}

export function makeTheme(isDark: boolean): Theme {
  return {
    colors: isDark ? dark : light,
    isDark,
    sport: (s) => ({ base: sportColor[s].base, tint: isDark ? sportColor[s].tintDark : sportColor[s].tint }),
  };
}

const lightTheme = makeTheme(false);
const darkTheme = makeTheme(true);

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? darkTheme : lightTheme;
}
