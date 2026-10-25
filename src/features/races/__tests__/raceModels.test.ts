import { describe, expect, test } from '@jest/globals';

import type { Race } from '@/domain/types';

import { initialRaceForm, toRaceDraft, validateRaceForm } from '../raceFormModel';
import { PHASE_TIMELINE, PRIORITY_INFO, countdown, phaseName, splitRaces, timelineIndex } from '../raceModel';

const TODAY = '2026-10-25';

function race(overrides: Partial<Race>): Race {
  return {
    id: 'r1',
    userId: 'me',
    name: 'Media de Valencia',
    date: '2027-03-17',
    distance: 'half',
    priority: 'A',
    location: 'Valencia',
    goal: null,
    notes: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('raceModel', () => {
  test('countdown wording', () => {
    expect(countdown(TODAY, TODAY)).toMatchObject({ value: 'HOY' });
    expect(countdown('2026-10-26', TODAY)).toEqual({ value: '1', unit: 'día', spoken: 'Falta 1 día' });
    expect(countdown('2027-03-17', TODAY)).toMatchObject({ value: '143', unit: 'días' });
    expect(countdown('2026-10-20', TODAY)).toMatchObject({ value: '5', spoken: 'Hace 5 días' });
  });

  test('splits upcoming (soonest first) and past (latest first)', () => {
    const list = [
      race({ id: 'a', date: '2027-05-01' }),
      race({ id: 'b', date: '2026-11-01' }),
      race({ id: 'c', date: '2026-06-01' }),
      race({ id: 'd', date: '2026-09-01' }),
      race({ id: 'e', date: TODAY }),
    ];
    const { upcoming, past } = splitRaces(list, TODAY);
    expect(upcoming.map((r) => r.id)).toEqual(['e', 'b', 'a']);
    expect(past.map((r) => r.id)).toEqual(['d', 'c']);
    expect(list[0]?.id).toBe('a');
  });

  test('timeline positions and names', () => {
    expect(PHASE_TIMELINE.map((s) => s.label)).toEqual(['Base', 'Construcción', 'Pico', 'Puesta a punto', 'Carrera']);
    expect(timelineIndex('prep')).toBe(-1);
    expect(timelineIndex('base')).toBe(0);
    expect(timelineIndex('race_week')).toBe(4);
    expect(timelineIndex('recovery')).toBeNull();
    expect(phaseName('build')).toBe('Construcción');
    expect(phaseName('transition')).toBe('Transición');
    expect(PRIORITY_INFO.A.help).toContain('afinamiento completo');
  });
});

describe('raceFormModel', () => {
  test('new form defaults ~3 months out', () => {
    const form = initialRaceForm(null, TODAY);
    expect(form).toMatchObject({ name: '', date: '2027-01-23', priority: 'B', distance: 'olympic' });
  });

  test('edit form round-trips to a trimmed draft with nulls', () => {
    const form = initialRaceForm(race({ goal: 'sub 5h' }), TODAY);
    const draft = toRaceDraft({ ...form, name: '  Media de Valencia ', notes: '   ' });
    expect(draft).toEqual({
      name: 'Media de Valencia',
      date: '2027-03-17',
      distance: 'half',
      priority: 'A',
      location: 'Valencia',
      goal: 'sub 5h',
      notes: null,
    });
  });

  test('validation returns Spanish errors', () => {
    const base = initialRaceForm(null, TODAY);
    const noName = validateRaceForm(base);
    expect(noName.ok).toBe(false);
    if (!noName.ok) expect(noName.error).toContain('nombre');
    const badDate = validateRaceForm({ ...base, name: 'Sprint', date: '2027-13-45' });
    expect(badDate.ok).toBe(false);
    const ok = validateRaceForm({ ...base, name: 'Sprint de Gandía' });
    expect(ok.ok).toBe(true);
  });
});
