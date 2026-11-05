import { fonts, intensityColor, type Theme } from '@/ui';

/**
 * Chart colours derived from theme tokens: calm, data-first. Gridlines are hairlines in
 * `border`, labels in `textMuted`. Green/yellow/orange/red stay reserved for compliance, so the
 * load series use the brand ink (Forma física), a muted rose (Fatiga) and steel blue (Frescura).
 * Series also differ by mark (thick line + area, thin line, bars) and are named in the legend.
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
    fitness: colors.accentInk,
    fatigue: intensityColor.vo2,
    freshPositive: intensityColor.endurance,
    freshNegative: colors.textFaint,
    grid: colors.border,
    axis: colors.textMuted,
    projection: colors.bg,
    band: colors.surfaceAlt,
    today: colors.text,
    marker: colors.surface,
    background: colors.surface,
    font: fonts.bodyMedium,
  };
}
