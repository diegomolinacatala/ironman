import { describe, expect, test } from '@jest/globals';

import { makeTheme } from '@/ui/theme';

import { raceChipPalette } from '../raceChipPalette';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('race chip colours', () => {
  test.each([
    ['light', false],
    ['dark', true],
  ])('days, flag and name are readable in %s mode (WCAG AA)', (_name, isDark) => {
    const ink = raceChipPalette(makeTheme(isDark));
    expect(contrast(ink.accent, ink.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ink.text, ink.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ink.accent, ink.pressed)).toBeGreaterThanOrEqual(3);
    expect(contrast(ink.text, ink.pressed)).toBeGreaterThanOrEqual(4.5);
  });
});
