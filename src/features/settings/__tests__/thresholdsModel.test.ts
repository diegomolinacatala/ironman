import { describe, expect, test } from '@jest/globals';

import {
  EMPTY_THRESHOLD_INPUTS,
  countThresholds,
  formatPace,
  parsePace,
  parseThresholdInputs,
  thresholdsToInputs,
} from '../thresholdsModel';

describe('thresholdsModel', () => {
  test('parsePace accepts mm:ss and common separators', () => {
    expect(parsePace('4:30')).toBe(270);
    expect(parsePace('4.05')).toBe(245);
    expect(parsePace("1'45")).toBe(105);
    expect(parsePace('5')).toBe(300);
  });

  test('parsePace rejects invalid input', () => {
    expect(parsePace('')).toBeNull();
    expect(parsePace('4:75')).toBeNull();
    expect(parsePace('abc')).toBeNull();
    expect(parsePace('4:30:10')).toBeNull();
  });

  test('formatPace pads seconds', () => {
    expect(formatPace(270)).toBe('4:30');
    expect(formatPace(65)).toBe('1:05');
  });

  test('thresholdsToInputs ↔ parseThresholdInputs round-trip', () => {
    const thresholds = { ftpW: 240, runThresholdPaceSecPerKm: 255, swimCssSecPer100m: 102, maxHr: 192, lthr: 172 };
    const inputs = thresholdsToInputs(thresholds);
    expect(inputs).toEqual({ ftpW: '240', runPace: '4:15', swimCss: '1:42', maxHr: '192', lthr: '172' });
    const parsed = parseThresholdInputs(inputs);
    expect(parsed.isValid).toBe(true);
    expect(parsed.thresholds).toEqual(thresholds);
  });

  test('empty inputs produce no thresholds and keep unmanaged base fields', () => {
    const parsed = parseThresholdInputs(EMPTY_THRESHOLD_INPUTS, { restingHr: 48, ftpW: 200 });
    expect(parsed.isValid).toBe(true);
    expect(parsed.thresholds).toEqual({ restingHr: 48 });
  });

  test('out of range and malformed values report Spanish errors', () => {
    const parsed = parseThresholdInputs({ ...EMPTY_THRESHOLD_INPUTS, ftpW: '20', runPace: 'rápido', maxHr: '19x' });
    expect(parsed.isValid).toBe(false);
    expect(parsed.errors.ftpW).toMatch(/FTP/);
    expect(parsed.errors.runPace).toMatch(/mm:ss/);
    expect(parsed.errors.maxHr).toMatch(/números/);
    expect(parsed.thresholds).toEqual({});
  });

  test('countThresholds counts filled fields', () => {
    expect(countThresholds(null)).toBe(0);
    expect(countThresholds({ ftpW: 200, lthr: 170, restingHr: 50 })).toBe(2);
  });
});
