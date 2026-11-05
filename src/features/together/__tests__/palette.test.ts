/**
 * Juntos colours under the "calm endurance" theme: no lime, readable in light and dark.
 */
import { describe, expect, test } from '@jest/globals';

import { contrastRatio } from '@/ui';
import { makeTheme } from '@/ui/theme';

import { busyHatch, slotEdge, slotInk, slotTint, toneColor } from '../palette';

const schemes = [
  ['light', makeTheme(false)],
  ['dark', makeTheme(true)],
] as const;

describe.each(schemes)('Juntos palette (%s)', (_name, theme) => {
  const { colors } = theme;

  test('common slots use the soft brand tint with accentInk edges', () => {
    expect(slotTint(colors)).toBe(colors.accentSoft);
    expect(slotEdge(colors)).toBe(colors.accentInk);
    expect(slotInk(colors)).toBe(colors.onAccentSoft);
  });

  test('slot text and muted meta stay readable on the slot band', () => {
    expect(contrastRatio(slotInk(colors), slotTint(colors))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.text, slotTint(colors))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.textMuted, slotTint(colors))).toBeGreaterThanOrEqual(4.5);
  });

  test('slot edges and "juntos" marks are visible on cards', () => {
    expect(contrastRatio(slotEdge(colors), colors.surface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(slotEdge(colors), slotTint(colors))).toBeGreaterThanOrEqual(3);
  });

  test('busy hatch is neutral (no brand or sport colour)', () => {
    const hatch = busyHatch(colors);
    expect(hatch.color).toBe(colors.borderStrong);
    expect(hatch.background).toBe(colors.surfaceAlt);
  });

  test('status tones map to theme semantics', () => {
    expect(toneColor('success', colors)).toBe(colors.success);
    expect(toneColor('danger', colors)).toBe(colors.danger);
    expect(toneColor('info', colors)).toBe(colors.info);
    expect(toneColor('muted', colors)).toBe(colors.textMuted);
  });
});
