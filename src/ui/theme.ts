/**
 * Road to Ironman design tokens — "calm endurance" (rebrand 2026-11).
 *
 * - Neutral-first: soft warm-grey paper (light) / deep blue-black (dark), ink text.
 * - One brand colour, "Atlántico" navy: primary actions, selection, links and highlights.
 *   In dark mode it becomes a soft blue so it keeps contrast without glowing.
 * - Sports are colour-coded consistently everywhere (cards, charts, widgets); green / yellow /
 *   orange / red stay reserved for compliance and status, always paired with an icon or text.
 * - Type: Inter everywhere (calm, legible, tabular figures for data). Hierarchy comes from size
 *   and weight, not from loud display faces.
 * - Light/dark: follows the system unless the user picks one in Tú → Apariencia (`appearance.ts`).
 */
import type { TextStyle } from 'react-native';

import type { Intensity, Sport } from '@/domain/types';

import { useResolvedColorScheme } from './appearance';

export const fonts = {
  /** Screen titles, hero numbers. */
  display: 'Inter_700Bold',
  /** Section titles, emphasised labels. */
  displaySemibold: 'Inter_600SemiBold',
  /** Metrics and counters (pair with `fontVariant: ['tabular-nums']`). */
  numeric: 'Inter_600SemiBold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemibold: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',
} as const;

/** 4-pt spacing scale. */
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
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

export const duration = {
  fast: 150,
  normal: 240,
  slow: 380,
} as const;

/** Icon sizes (SF Symbols / vector icons). */
export const iconSize = {
  sm: 16,
  md: 20,
  lg: 24,
} as const;

const tabular: TextStyle['fontVariant'] = ['tabular-nums'];

/** Text styles. Font families resolve once fonts are loaded in the root layout. */
export const type = {
  hero: { fontFamily: fonts.display, fontSize: 40, lineHeight: 46, letterSpacing: -1.2 },
  display: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, letterSpacing: -0.8 },
  title: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28, letterSpacing: -0.4 },
  heading: { fontFamily: fonts.bodySemibold, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23 },
  bodyStrong: { fontFamily: fonts.bodySemibold, fontSize: 16, lineHeight: 23 },
  callout: { fontFamily: fonts.bodyMedium, fontSize: 15, lineHeight: 21 },
  caption: { fontFamily: fonts.bodyMedium, fontSize: 13, lineHeight: 18 },
  overline: {
    fontFamily: fonts.bodySemibold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  metric: { fontFamily: fonts.numeric, fontSize: 30, lineHeight: 36, letterSpacing: -0.8, fontVariant: tabular },
  metricSmall: { fontFamily: fonts.numeric, fontSize: 20, lineHeight: 26, letterSpacing: -0.4, fontVariant: tabular },
} as const satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof type;

/** Brand palette (raw values; components use the semantic tokens below). */
export const brand = {
  navy: '#1F3A68',
  navyDeep: '#172C50',
  navyInk: '#2A4E8C',
  sky: '#A9C1EE',
  skyPressed: '#93AEE3',
  ink: '#121826',
  paper: '#F6F5F1',
  night: '#0E1116',
  /** Warm sun of the brand mark (sign-in / onboarding hero only). */
  sun: '#F2C38B',
};

const light = {
  scheme: 'light' as 'light' | 'dark',
  bg: brand.paper,
  bgElevated: '#FBFAF7',
  surface: '#FFFFFF',
  surfaceAlt: '#EFEEE9',
  surfacePressed: '#E6E4DD',
  border: '#E3E1DA',
  borderStrong: '#C9C6BC',
  text: brand.ink,
  textMuted: '#555D6B',
  textFaint: '#8A909B',
  inverseBg: brand.ink,
  inverseText: brand.paper,
  /** Primary action fill (buttons, selected chips, active states). */
  accent: brand.navy,
  accentPressed: brand.navyDeep,
  onAccent: '#FFFFFF',
  /** Brand colour usable as text/icon on bg/surface (links, highlights). */
  accentInk: brand.navyInk,
  /** Soft brand tint for highlighted surfaces ("hoy", "juntos", selected rows). */
  accentSoft: '#E5EBF5',
  /** Text/icon on `accentSoft`. */
  onAccentSoft: brand.navy,
  /** Darker than the compliance green/amber so status text clears 4.5:1 on paper, surface and wells. */
  success: '#187A47',
  warning: '#8F5E00',
  danger: '#C8372D',
  info: '#265CB0',
  overlay: 'rgba(18,24,38,0.45)',
  shadow: 'rgba(18,24,38,0.08)',
};

const dark: typeof light = {
  scheme: 'dark',
  bg: brand.night,
  bgElevated: '#13171D',
  surface: '#171C23',
  surfaceAlt: '#1E242C',
  surfacePressed: '#262D37',
  border: '#29313B',
  borderStrong: '#3A4350',
  text: '#ECEFF3',
  textMuted: '#A2AAB5',
  textFaint: '#6E7783',
  inverseBg: '#ECEFF3',
  inverseText: brand.night,
  accent: brand.sky,
  accentPressed: brand.skyPressed,
  onAccent: '#0E1A2E',
  accentInk: brand.sky,
  accentSoft: '#1B2638',
  onAccentSoft: '#C9D8F5',
  success: '#3DBE7C',
  warning: '#E5AE3C',
  danger: '#F06A5E',
  info: '#7AA7F0',
  overlay: 'rgba(0,0,0,0.6)',
  shadow: 'rgba(0,0,0,0.5)',
};

export type ThemeColors = typeof light;

/**
 * Sport colours (same hue in both schemes; `tint` is a soft background).
 * Green / yellow / orange / red are RESERVED for compliance states, so sports
 * use blue, violet, teal, plum, slate and rose — slightly muted so they read as data, not neon.
 */
export const sportColor: Record<Sport, { base: string; tint: string; tintDark: string }> = {
  swim: { base: '#2F80C9', tint: '#E1ECF8', tintDark: '#132536' },
  bike: { base: '#7B61D1', tint: '#ECE7FA', tintDark: '#231D3D' },
  run: { base: '#12928C', tint: '#DCF1EF', tintDark: '#0E2B2A' },
  brick: { base: '#B0529F', tint: '#F4E4F1', tintDark: '#2F1A2C' },
  strength: { base: '#5D6776', tint: '#E7E9EC', tintDark: '#20252C' },
  mobility: { base: '#6A83C2', tint: '#E5EAF6', tintDark: '#1B2234' },
  other: { base: '#C95A87', tint: '#F8E6EE', tintDark: '#33192A' },
  rest: { base: '#9AA1AB', tint: '#EDEEEF', tintDark: '#23272D' },
};

/** Intensity scale colours (Z1 → race), cool → hot. */
export const intensityColor: Record<Intensity, string> = {
  recovery: '#9DB0C2',
  endurance: '#5A93C9',
  tempo: '#8577BD',
  threshold: '#B85C9A',
  vo2: '#D04A76',
  race: '#A3195A',
};

/** Compliance states (TrainingPeaks convention). Always pair with an icon. */
export const complianceColor = {
  done: '#1E8A52',
  partial: '#C9A100',
  off: '#DD7420',
  missed: '#C8372D',
  unplanned: '#9AA1AB',
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

/** Current theme: system scheme unless the user forced light/dark in Tú → Apariencia. */
export function useTheme(): Theme {
  return useResolvedColorScheme() === 'dark' ? darkTheme : lightTheme;
}
