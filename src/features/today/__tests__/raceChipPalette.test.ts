import { describe, expect, test } from '@jest/globals';

import { contrastRatio } from '@/ui/color';
import { brand, makeTheme } from '@/ui/theme';

import { raceChipPalette } from '../raceChipPalette';

const RETIRED_LIME = '#D4FF3A';

describe('race chip colours', () => {
  test.each([
    ['light', false],
    ['dark', true],
  ])('days, flag and name are readable in %s mode (WCAG AA)', (_name, isDark) => {
    const ink = raceChipPalette(makeTheme(isDark));
    expect(contrastRatio(ink.accent, ink.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ink.text, ink.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ink.accent, ink.tile)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ink.accent, ink.pressed)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(ink.text, ink.pressed)).toBeGreaterThanOrEqual(4.5);
  });

  test.each([
    ['light', false],
    ['dark', true],
  ])('uses the soft brand highlight, never the inverse panel or lime, in %s mode', (_name, isDark) => {
    const theme = makeTheme(isDark);
    const ink = raceChipPalette(theme);
    expect(ink.background).toBe(theme.colors.accentSoft);
    expect(ink.background).not.toBe(theme.colors.inverseBg);
    expect(Object.values(ink).map((c) => c.toUpperCase())).not.toContain(RETIRED_LIME);
  });

  test('light mode keeps the navy brand on the chip', () => {
    expect(raceChipPalette(makeTheme(false)).text).toBe(brand.navy);
  });
});
