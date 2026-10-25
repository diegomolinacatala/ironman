import { fonts, intensityColor, type Theme } from '@/ui';

/**
 * Chart colours derived from theme tokens. Green/yellow/orange/red stay
 * reserved for compliance, so load lines use ink, hot pink and info blue.
 */
export interface ChartPalette {
  fitness: string;
  fatigue: string;
  freshPositive: string;
  freshNegative: string;
  grid: string;
  axis: string;
  projection: string;
  band: string;
  today: string;
  marker: string;
  background: string;
  font: string;
}

export function chartPalette(theme: Theme): ChartPalette {
  const { colors } = theme;
  return {
    fitness: colors.text,
    fatigue: intensityColor.vo2,
    freshPositive: colors.info,
    freshNegative: colors.textFaint,
    grid: colors.border,
    axis: colors.textFaint,
    projection: colors.surfaceAlt,
    band: theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(21,23,26,0.04)',
    today: colors.text,
    marker: colors.accent,
    background: colors.surface,
    font: fonts.displayMedium,
  };
}
