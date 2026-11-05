/**
 * Colours of the race countdown chip (pure) — the single race countdown in the app.
 *
 * A calm brand highlight in both schemes: `accentSoft` surface with `onAccentSoft` content
 * (navy in light, pale sky in dark); the flag sits on a `surface` tile. Never on `inverseBg`,
 * which is light paper in dark mode.
 */
import type { Theme } from '@/ui';

export interface RaceChipPalette {
  background: string;
  pressed: string;
  border: string;
  /** Race name and phase. */
  text: string;
  /** Days left and the flag icon. */
  accent: string;
  /** Background of the flag tile. */
  tile: string;
}

export function raceChipPalette({ colors }: Pick<Theme, 'colors' | 'isDark'>): RaceChipPalette {
  return {
    background: colors.accentSoft,
    pressed: colors.surfacePressed,
    border: colors.accentSoft,
    text: colors.onAccentSoft,
    accent: colors.onAccentSoft,
    tile: colors.surface,
  };
}
