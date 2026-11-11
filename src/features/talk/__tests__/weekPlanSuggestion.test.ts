import { describe, expect, test } from '@jest/globals';

import type { WeekPlanDraft } from '@/domain/types';

import { weekPlanLabel, weekPlanSource, weekPlanSuggestion, weekPlansHeading } from '../weekPlanSuggestion';

// Tuesday: this week's Monday is 2026-11-09.
const TODAY = '2026-11-10';

describe('weekPlanLabel', () => {
  test('"Lun 16 nov · Descarga · 5 h" (day, kind, hours as athletes read them)', () => {
    expect(weekPlanLabel({ weekStart: '2026-11-16', kind: 'recovery', targetMinutes: 300 })).toBe('Lun 16 nov · Descarga · 5 h');
    expect(weekPlanLabel({ weekStart: '2026-11-23', kind: 'push', targetMinutes: 570 })).toBe('Lun 23 nov · Más volumen · 9,5 h');
  });

  test('no hours when the coach gave none', () => {
    expect(weekPlanLabel({ weekStart: '2026-11-30', kind: 'rest', targetMinutes: null })).toBe('Lun 30 nov · Semana libre');
    expect(weekPlanLabel({ weekStart: '2026-11-30', kind: 'load', targetMinutes: 0 })).toBe('Lun 30 nov · Carga');
  });
});

describe('weekPlanSuggestion', () => {
  test('keeps valid Mondays from this week to a year ahead, in date order, first one per week', () => {
    const drafts: WeekPlanDraft[] = [
      { weekStart: '2026-11-23', kind: 'push', targetMinutes: 540, note: null },
      { weekStart: '2026-11-09', kind: 'load', targetMinutes: 480, note: 'Esta semana, normal.' },
      { weekStart: '2026-11-23', kind: 'rest', targetMinutes: 0, note: 'Duplicada' },
      { weekStart: '2026-11-17', kind: 'recovery', targetMinutes: 300, note: 'No es lunes' },
      { weekStart: '2026-11-02', kind: 'recovery', targetMinutes: 300, note: 'Ya pasó' },
      { weekStart: '2027-11-15', kind: 'load', targetMinutes: 300, note: 'Más de un año' },
      { weekStart: '2026-11-30', kind: 'taper' as WeekPlanDraft['kind'], targetMinutes: 300, note: 'Tipo raro' },
      { weekStart: 'lunes' as WeekPlanDraft['weekStart'], kind: 'load', targetMinutes: 300, note: null },
    ];
    const { drafts: kept, rows } = weekPlanSuggestion(drafts, TODAY);
    expect(kept.map((d) => [d.weekStart, d.kind])).toEqual([
      ['2026-11-09', 'load'],
      ['2026-11-23', 'push'],
    ]);
    expect(rows).toEqual([
      { weekStart: '2026-11-09', label: 'Lun 9 nov · Carga · 8 h', note: 'Esta semana, normal.' },
      { weekStart: '2026-11-23', label: 'Lun 23 nov · Más volumen · 9 h', note: null },
    ]);
  });

  test('clamps minutes to 0–3000 and cleans notes (spaces, empty, 300 characters)', () => {
    const { drafts } = weekPlanSuggestion(
      [
        { weekStart: '2026-11-16', kind: 'load', targetMinutes: 5000, note: '  Sube   poco a poco  ' },
        { weekStart: '2026-11-23', kind: 'load', targetMinutes: -5, note: '   ' },
        { weekStart: '2026-11-30', kind: 'load', targetMinutes: Number.NaN, note: 'x'.repeat(400) },
        { weekStart: '2026-12-07', kind: 'load', targetMinutes: 300.4 },
      ],
      TODAY,
    );
    expect(drafts.map((d) => d.targetMinutes)).toEqual([3000, 0, null, 300]);
    expect(drafts.map((d) => d.note?.length ?? null)).toEqual(['Sube poco a poco'.length, null, 300, null]);
    expect(drafts[0]?.note).toBe('Sube poco a poco');
  });

  test('nothing to show without suggestions', () => {
    expect(weekPlanSuggestion(undefined, TODAY)).toEqual({ drafts: [], rows: [] });
    expect(weekPlanSuggestion([], TODAY)).toEqual({ drafts: [], rows: [] });
  });
});

describe('labels and source', () => {
  test('the AI coach saves as ai_coach; the rules engine as your own plan', () => {
    expect(weekPlanSource('ai')).toBe('ai_coach');
    expect(weekPlanSource('rules')).toBe('manual');
  });

  test('heading counts the weeks', () => {
    expect(weekPlansHeading(1)).toBe('Plan general · 1 semana');
    expect(weekPlansHeading(3)).toBe('Plan general · 3 semanas');
  });
});
