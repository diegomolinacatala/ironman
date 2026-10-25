/**
 * Colour helpers for the Juntos visuals. Lime is the "juntos" highlight
 * (common slots, shared sessions); status tones reuse theme semantics.
 */
import type { Theme } from '@/ui';

import type { Tone } from './jointModel';

type Colors = Theme['colors'];

/** Soft lime band used for common free slots. */
export function slotTint(colors: Colors): string {
  return colors.scheme === 'dark' ? `${colors.accent}40` : `${colors.accent}8C`;
}

/** Stronger lime used for slot edges and "juntos" accents. */
export function slotEdge(colors: Colors): string {
  return colors.scheme === 'dark' ? colors.accent : colors.accentInk;
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
