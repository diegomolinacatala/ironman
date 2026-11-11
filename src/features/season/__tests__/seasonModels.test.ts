import { describe, expect, test } from '@jest/globals';

import type { SeasonWeek } from '@/domain/season';
import type { WeekPlan } from '@/domain/types';
import { makeWorkout } from '@/features/workouts/__tests__/fixtures';

import { autoMinutes, clampMinutes, initialAdjustForm, stepMinutes, toWeekPlanDraft } from '../adjustModel';
import {
  adjustBlockedReason,
  detailLabel,
  formatSeasonHours,
  formatTrend,
  groupSeasonBlocks,
  legendItems,
  previewTitle,
  previewWeekLabel,
  raceCountdown,
  seasonRange,
  sessionsByWeek,
  spokenHours,
  stripMarker,
  volumeSpoken,
  weekCaption,
  weekDates,
  weekRowLabel,
  weekWhy,
} from '../seasonModel';

const MONDAY = '2026-11-09';

function week(overrides: Partial<SeasonWeek> = {}): SeasonWeek {
  return {
    weekStart: MONDAY,
    number: 1,
    kind: 'load',
    label: 'Carga',
    phase: 'base',
    phaseLabel: 'Base 2',
    focus: 'Fondo aeróbico.',
    why: 'Construimos el motor aeróbico.',
    volumeFactor: 1,
    targetMinutes: 390,
    trend: null,
    race: null,
    plan: null,
    editable: true,
    isCurrent: false,
    ...overrides,
  };
}

function plan(overrides: Partial<WeekPlan> = {}): WeekPlan {
  return { weekStart: MONDAY, kind: 'push', targetMinutes: null, note: null, source: 'manual', updatedAt: '2026-11-09T08:00:00Z', ...overrides };
}

describe('season copy', () => {
  test('hours, trend and dates read the way athletes read them', () => {
    expect(formatSeasonHours(390)).toBe("6 h 30'");
    expect(formatSeasonHours(360)).toBe('6 h');
    expect(formatSeasonHours(45)).toBe("45'");
    expect(formatSeasonHours(Number.NaN)).toBe("0'");
    expect(spokenHours(390)).toBe('6 horas y 30 minutos');
    expect(spokenHours(60)).toBe('1 hora');
    expect(formatTrend(0.1)).toBe('+10 %');
    expect(formatTrend(-0.4)).toBe('−40 %');
    expect(formatTrend(0)).toBe('Igual');
    expect(formatTrend(null)).toBeNull();
    expect(weekDates(MONDAY)).toBe('9–15 nov');
    expect(weekDates('2026-11-30')).toBe('30 nov–6 dic');
  });

  test('the caption names this week and the why prefers the athlete note', () => {
    expect(weekCaption(week({ isCurrent: true }))).toBe('Esta semana · 9–15 nov · Base 2');
    expect(weekCaption(week({ weekStart: '2026-11-16' }))).toBe('16–22 nov · Base 2');
    expect(weekWhy(week())).toBe('Construimos el motor aeróbico.');
    expect(weekWhy(week({ plan: plan({ note: ' Viaje a Londres ' }) }))).toBe('Viaje a Londres');
  });

  test('race countdown counts days under two weeks and weeks after that', () => {
    expect(raceCountdown('2026-11-19', '2026-11-10')).toMatchObject({ value: '9', unit: 'días' });
    expect(raceCountdown('2027-02-09', '2026-11-10')).toEqual({ value: '13', unit: 'semanas', spoken: 'Faltan 13 semanas' });
  });

  test('taper, race and post-race weeks explain why they cannot be adjusted', () => {
    expect(adjustBlockedReason(week())).toBeNull();
    expect(adjustBlockedReason(week({ kind: 'taper', label: 'Afinamiento', editable: false }))).toBe('Afinamiento: lo marca la carrera');
    expect(adjustBlockedReason(week({ kind: 'race', label: 'Carrera', editable: false }))).toBe('Semana de carrera: la organiza la carrera');
    expect(adjustBlockedReason(week({ kind: 'transition', editable: false }))).toBe('Después de la carrera: toca recuperar');
  });

  test('detailed weeks count planned sessions, not rest days or skipped ones', () => {
    const counts = sessionsByWeek([
      makeWorkout({ id: 'a', date: '2026-11-10' }),
      makeWorkout({ id: 'b', date: '2026-11-15' }),
      makeWorkout({ id: 'c', date: '2026-11-11', sport: 'rest' }),
      makeWorkout({ id: 'd', date: '2026-11-12', status: 'skipped' }),
      makeWorkout({ id: 'e', date: '2026-11-17' }),
    ]);
    expect(counts).toEqual({ [MONDAY]: 2, '2026-11-16': 1 });
    expect(detailLabel(0)).toBe('Sin detallar');
    expect(detailLabel(1)).toBe('Detallada · 1 sesión');
    expect(detailLabel(6)).toBe('Detallada · 6 sesiones');
  });

  test('a row speaks everything it shows', () => {
    const label = weekRowLabel(week({ isCurrent: true, trend: 0.1, plan: plan() }), 6, ['Tirada larga 1h 30\'']);
    expect(label).toContain('Esta semana, semana del 9 de noviembre');
    expect(label).toContain('6 horas y 30 minutos');
    expect(label).toContain('10 % más que la semana anterior');
    expect(label).toContain('Ajustada');
    expect(label).toContain('Detallada · 6 sesiones');
    expect(label).toContain("Claves: Tirada larga 1h 30'");
  });
});

describe('season blocks and volume strip', () => {
  test('groups consecutive weeks by block and joins taper with the race', () => {
    const weeks = [
      week({ phaseLabel: 'Base 2' }),
      week({ weekStart: '2026-11-16', kind: 'recovery', label: 'Descarga' }),
      week({ weekStart: '2026-11-23', phase: 'build', phaseLabel: 'Construcción 1' }),
      week({ weekStart: '2026-11-30', phase: 'taper', kind: 'taper', label: 'Afinamiento', editable: false }),
      week({ weekStart: '2026-12-07', phase: 'race_week', kind: 'race', label: 'Carrera', editable: false }),
    ];
    expect(groupSeasonBlocks(weeks).map((b) => b.title)).toEqual(['Base · 2 semanas', 'Construcción · 1 semana', 'Afinamiento y carrera']);
    expect(groupSeasonBlocks([week({ phaseLabel: 'Mantenimiento' })])[0]?.title).toBe('Mantenimiento · 1 semana');
  });

  test('markers and legend only for weeks that are not a normal load week', () => {
    expect(stripMarker('load')).toBeNull();
    expect(stripMarker('push')).toBeNull();
    expect(stripMarker('recovery')).toBe('moon');
    expect(stripMarker('race')).toBe('flag');
    const weeks = [week(), week({ kind: 'recovery' }), week({ kind: 'race' })];
    expect(legendItems(weeks).map((i) => i.label)).toEqual(['Descarga', 'Carrera']);
  });

  test('the strip has a spoken summary', () => {
    const weeks = [
      week({ isCurrent: true }),
      week({ number: 2, weekStart: '2026-11-16', targetMinutes: 430 }),
      week({ number: 3, weekStart: '2026-11-23', kind: 'recovery', label: 'Descarga', targetMinutes: 240 }),
    ];
    expect(volumeSpoken(weeks)).toBe(
      'Horas por semana durante 3 semanas. Esta semana, 6 horas y 30 minutos. Máximo, 7 horas y 10 minutos en la semana 2. Descarga en la semana 3.',
    );
    expect(volumeSpoken([])).toBe('');
  });

  test('loads from this Monday to the Sunday of the last week (8 weeks without a race)', () => {
    expect(seasonRange('2026-11-10', [])).toEqual({ from: MONDAY, to: '2027-01-03' });
  });

  test('preview copy for the onboarding block', () => {
    expect(previewTitle({ targetRace: null })).toBe('Tus próximas semanas');
    expect(previewWeekLabel(week({ isCurrent: true }))).toBe('Esta semana: Carga, 6 horas y 30 minutos');
    expect(previewWeekLabel(week({ weekStart: '2026-11-16', label: 'Descarga', targetMinutes: 240 }))).toBe(
      'Semana del 16 de noviembre: Descarga, 4 horas',
    );
  });
});

describe('Ajustar semana', () => {
  test('opens with the override when there is one, else with the week kind', () => {
    expect(initialAdjustForm(week({ kind: 'recovery', targetMinutes: 237 }))).toEqual({ kind: 'recovery', hoursMode: 'auto', minutes: 240, note: '' });
    expect(initialAdjustForm(week({ kind: 'taper' })).kind).toBe('load');
    expect(initialAdjustForm(week({ plan: plan({ kind: 'push', targetMinutes: 600, note: 'Puente' }) }))).toEqual({
      kind: 'push',
      hoursMode: 'custom',
      minutes: 600,
      note: 'Puente',
    });
  });

  test('saves a manual draft with trimmed note and hours only when chosen', () => {
    expect(toWeekPlanDraft({ kind: 'recovery', hoursMode: 'auto', minutes: 300, note: '   ' }, MONDAY)).toEqual({
      weekStart: MONDAY,
      kind: 'recovery',
      targetMinutes: null,
      note: null,
      source: 'manual',
    });
    expect(toWeekPlanDraft({ kind: 'rest', hoursMode: 'custom', minutes: 5000, note: ' Vacaciones ' }, MONDAY)).toMatchObject({
      targetMinutes: 3000,
      note: 'Vacaciones',
    });
    expect(clampMinutes(-5)).toBe(0);
    expect(stepMinutes(397)).toBe(390);
  });

  test('prices each option like the season does', () => {
    const ctx = { races: [], level: 'intermediate' as const, weeklyHoursTarget: 10 };
    const load = autoMinutes(MONDAY, 'load', ctx);
    expect(autoMinutes(MONDAY, 'push', ctx)).toBeGreaterThan(load);
    expect(autoMinutes(MONDAY, 'recovery', ctx)).toBeLessThan(load);
    expect(autoMinutes(MONDAY, 'rest', ctx)).toBeLessThan(autoMinutes(MONDAY, 'recovery', ctx));
    expect(load % 5).toBe(0);
  });
});
