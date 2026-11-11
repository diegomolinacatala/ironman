import { describe, expect, test } from '@jest/globals';

import type { Thresholds } from '@/domain/types';

import {
  EMPTY_THRESHOLD_INPUTS,
  countThresholds,
  formatPace,
  parsePace,
  parseThresholdInputs,
  thresholdsToInputs,
  zonePreviewNote,
  zonePreviewRows,
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
    const thresholds = { ftpW: 240, runThresholdPaceSecPerKm: 255, swimCssSecPer100m: 102, maxHr: 192, lthr: 172, restingHr: 48 };
    const inputs = thresholdsToInputs(thresholds);
    expect(inputs).toEqual({ ftpW: '240', runPace: '4:15', swimCss: '1:42', maxHr: '192', lthr: '172', restingHr: '48' });
    const parsed = parseThresholdInputs(inputs);
    expect(parsed.isValid).toBe(true);
    expect(parsed.thresholds).toEqual(thresholds);
  });

  test('empty inputs clear every managed field (resting HR included) and keep unknown base fields', () => {
    const base = { restingHr: 48, ftpW: 200, futureField: 1 } as Thresholds;
    const parsed = parseThresholdInputs(EMPTY_THRESHOLD_INPUTS, base);
    expect(parsed.isValid).toBe(true);
    expect(parsed.thresholds).toEqual({ futureField: 1 });
  });

  test('resting HR and FTP follow the validation limits', () => {
    expect(parseThresholdInputs({ ...EMPTY_THRESHOLD_INPUTS, restingHr: '20' }).errors.restingHr).toBe('FC en reposo entre 25 y 120 ppm');
    expect(parseThresholdInputs({ ...EMPTY_THRESHOLD_INPUTS, restingHr: '52' }).thresholds).toEqual({ restingHr: 52 });
    expect(parseThresholdInputs({ ...EMPTY_THRESHOLD_INPUTS, ftpW: '700' }).isValid).toBe(true);
    expect(parseThresholdInputs({ ...EMPTY_THRESHOLD_INPUTS, ftpW: '701' }).errors.ftpW).toBe('El FTP debe estar entre 50 y 700 W');
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

describe('"Tus zonas" preview', () => {
  const full: Thresholds = { lthr: 170, runThresholdPaceSecPerKm: 270, ftpW: 250, swimCssSecPer100m: 105 };

  test('run: Z1–Z5 with ppm and pace, no race row', () => {
    const rows = zonePreviewRows(full, 'run');
    expect(rows.map((r) => r.zone)).toEqual(['Z1', 'Z2', 'Z3', 'Z4', 'Z5']);
    expect(rows[1]).toEqual({ intensity: 'endurance', zone: 'Z2', name: 'Fondo', values: '145–151 ppm · 5:08–5:48 /km' });
    expect(rows[3]?.values).toBe('162–168 ppm · 4:27–4:44 /km');
    expect(zonePreviewNote(full, 'run')).toBe('');
  });

  test('bike puts watts first; swim shows the CSS pace only', () => {
    expect(zonePreviewRows(full, 'bike')[3]?.values).toBe('225–260 W · 155–163 ppm');
    expect(zonePreviewRows(full, 'swim')[1]?.values).toBe('1:53–2:00 /100 m');
  });

  test('heart rate from the max HR is marked as approximate', () => {
    expect(zonePreviewRows({ maxHr: 190 }, 'run')[1]?.values).toBe('145–151 ppm aprox.');
    expect(zonePreviewNote({ maxHr: 190 }, 'run')).toBe('Añade tu ritmo umbral para ver aquí tus números.');
    expect(zonePreviewNote({ maxHr: 190, runThresholdPaceSecPerKm: 270 }, 'run')).toBe(
      'Pulsaciones aproximadas: con tu FC umbral serán más precisas.',
    );
  });

  test('without thresholds the zones fall back to RPE and say what to add', () => {
    expect(zonePreviewRows({}, 'run').map((r) => r.values)).toEqual(['RPE 1–2', 'RPE 3–4', 'RPE 5–6', 'RPE 7–8', 'RPE 9']);
    expect(zonePreviewNote({}, 'bike')).toBe('Añade tu FTP y tu FC umbral o tu FC máxima para ver aquí tus números.');
    expect(zonePreviewNote({}, 'swim')).toBe('Añade tu CSS para ver aquí tus números.');
  });
});
