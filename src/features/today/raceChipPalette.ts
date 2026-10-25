/**
 * Colours of the race countdown chip (pure).
 *
 * Light mode: ink chip with lime days (the race-bib look). In dark mode the
 * theme's `inverseBg` is light paper, where lime is invisible (~1:1), so the
 * chip stays on a dark ink surface with a lime outline instead.
 */
import type { Theme } from '@/ui';

export interface RaceChipPalette {
  background: string;
  pressed: string;
  border: string;
  /** Race name and phase pill. */
  text: string;
  /** Days left and the flag icon. */
  accent: string;
}

export function raceChipPalette({ colors, isDark }: Pick<Theme, 'colors' | 'isDark'>): RaceChipPalette {
  if (isDark) {
    return {
      background: colors.surfaceAlt,
      pressed: colors.surfacePressed,
      border: colors.accent,
      text: colors.text,
      accent: colors.accent,
    };
  }
  return {
    background: colors.inverseBg,
    pressed: colors.textMuted,
    border: colors.inverseBg,
    text: colors.inverseText,
    accent: colors.accent,
  };
}
