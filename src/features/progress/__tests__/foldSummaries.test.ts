import { describe, expect, test } from '@jest/globals';

import { formFoldSummary, nutritionFoldSummary, recoveryFoldSummary, volumeFoldSummary } from '../foldSummaries';
import type { PmcSeries } from '../pmcModel';
import type { RecoverySeries } from '../recoveryModel';
import type { VolumeWeek } from '../volumeModel';

const point = { date: '2026-11-25', load: 60, ctl: 41.6, atl: 50.2, tsb: -8.4 };

function pmc(overrides: Partial<PmcSeries> = {}): PmcSeries {
  return { points: [point], todayIndex: 0, latest: point, projected: null, rampWeek: 2, hasData: true, firstIndex: 0, ...overrides } as PmcSeries;
}

function week(overrides: Partial<VolumeWeek> = {}): VolumeWeek {
  return { weekStart: '2026-11-23', label: '23 nov', isCurrent: true, plannedMin: 360, completedMin: 200, bySport: [], compliancePct: 0.8, ...overrides };
}

function series(key: RecoverySeries['key'], label: string, unit: string, latest: number | null): RecoverySeries {
  return { key, label, unit, latest, values: [], dates: [], latestDate: null, average: null, deltaPct: null } as unknown as RecoverySeries;
}

describe('Progreso fold summaries carry the number', () => {
  test('form', () => {
    expect(formFoldSummary(pmc())).toMatch(/^Forma 42 · frescura [−-]8$/);
    expect(formFoldSummary(pmc({ hasData: false }))).toBe('Forma física, fatiga y frescura');
    expect(formFoldSummary(null)).toBe('Forma física, fatiga y frescura');
  });

  test('volume of the current week', () => {
    expect(volumeFoldSummary([week({ isCurrent: false }), week()])).toBe('Esta semana 3,3 h de 6 h · 80 %');
    expect(volumeFoldSummary([week({ plannedMin: 0, compliancePct: null })])).not.toMatch(/ de |%/);
    expect(volumeFoldSummary([])).toBe('Horas por semana y lo que has cumplido');
  });

  test('recovery: latest values present, or how to get them', () => {
    const text = recoveryFoldSummary([series('hrvMs', 'VFC', 'ms', 62), series('restingHr', 'FC en reposo', 'ppm', null), series('sleepHours', 'Sueño', 'h', 7.24)]);
    expect(text).toBe('VFC 62 ms · Sueño 7,2 h');
    expect(recoveryFoldSummary([series('hrvMs', 'VFC', 'ms', null)])).toMatch(/Conecta tu reloj/);
  });

  test('nutrition', () => {
    const totals = { kcal: 1849.6, carbsG: 230.2, proteinG: 90, fatG: 60, hasMacros: true };
    expect(nutritionFoldSummary({ totals, entries: 3 })).toBe('1850 kcal · 230 g de hidratos');
    expect(nutritionFoldSummary({ totals: { ...totals, kcal: 0, hasMacros: false }, entries: 2 })).toBe('2 comidas apuntadas');
    expect(nutritionFoldSummary(null)).toBe('Nada apuntado hoy');
  });
});
