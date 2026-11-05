/**
 * Colour helpers for the Juntos visuals. "Juntos" highlights (common free slots, shared
 * sessions) use the soft brand tint (`accentSoft`) with `accentInk` edges, so they read as
 * highlighted without shouting; busy time stays neutral; status tones reuse theme semantics.
 */
import type { Theme } from '@/ui';

import type { Tone } from './jointModel';

type Colors = Theme['colors'];

/** Soft brand band used for common free slots ("huecos comunes"). */
export function slotTint(colors: Colors): string {
  return colors.accentSoft;
}

/** Edge of slot bands and the colour of "juntos" marks (icons, outlines). */
export function slotEdge(colors: Colors): string {
  return colors.accentInk;
}

/** Text drawn on a slot band. */
export function slotInk(colors: Colors): string {
  return colors.onAccentSoft;
}

/** Neutral hatch for busy ("Ocupado") time: stripes + fill. */
export function busyHatch(colors: Colors): { color: string; background: string } {
  return { color: colors.borderStrong, background: colors.surfaceAlt };
}

export function toneColor(tone: Tone, colors: Colors): string {
  switch (tone) {
    case 'success':
      return colors.success;
    case 'danger':
      return colors.danger;
    case 'info':
      return colors.info;
    default:
      return colors.textMuted;
  }
}
