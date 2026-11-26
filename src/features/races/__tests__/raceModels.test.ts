import { describe, expect, test } from '@jest/globals';

import type { Race } from '@/domain/types';

import { PREP_OPTIONS, changesSeason, defaultRaceName, formPrep, initialRaceForm, prepHint, toRaceDraft, validateRaceForm } from '../raceFormModel';
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
    expect(countdown(TODAY, TODAY)).toMatchObject({ value: 'Hoy' });
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
    expect(PHASE_TIMELINE.map((s) => s.label)).toEqual(['Base', 'Construcción', 'Pico', 'Afinamiento', 'Carrera']);
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
      prep: null,
    });
  });

  test('B and C races ask how to prepare them: their choice, else the default (B afinar, C como entreno)', () => {
    const b = initialRaceForm(null, TODAY);
    expect(b.prep).toBeNull();
    expect(formPrep(b)).toBe('taper');
    expect(formPrep({ ...b, priority: 'C' })).toBe('training');
    expect(formPrep({ ...b, priority: 'A' })).toBeNull();
    expect(formPrep({ ...b, prep: 'specific' })).toBe('specific');
    expect(PREP_OPTIONS.map((o) => o.label)).toEqual(['Como entreno', 'Solo afinar', 'Específica']);
    expect(prepHint('specific')).toBe('Preparación específica: las 3 semanas antes, más sesiones a su ritmo; tu carrera A sigue mandando.');
    expect(prepHint('training')).toMatch(/sin afinar/);
    expect(prepHint('taper')).toMatch(/mini-afinamiento de 3–5 días/);
  });

  test('the choice is saved for B/C races and cleared for A; an edit keeps it', () => {
    const base = { ...initialRaceForm(null, TODAY), name: 'Olímpico de Madrid' };
    expect(toRaceDraft({ ...base, prep: 'specific' }).prep).toBe('specific');
    expect(toRaceDraft(base).prep).toBeNull();
    expect(toRaceDraft({ ...base, priority: 'A', prep: 'specific' }).prep).toBeNull();
    expect(initialRaceForm(race({ priority: 'C', prep: 'taper' }), TODAY).prep).toBe('taper');
    const ok = validateRaceForm({ ...base, prep: 'training' });
    expect(ok.ok && ok.draft.prep).toBe('training');
  });

  test('the first race defaults to A (the season goal)', () => {
    expect(initialRaceForm(null, TODAY, true).priority).toBe('A');
    expect(initialRaceForm(null, TODAY, false).priority).toBe('B');
  });

  test('an empty name becomes "<distance> de <mes>"', () => {
    const base = initialRaceForm(null, TODAY);
    expect(defaultRaceName('olympic', '2027-03-14')).toBe('Olímpico de marzo');
    const noName = validateRaceForm({ ...base, name: '   ' });
    expect(noName.ok).toBe(true);
    if (noName.ok) expect(noName.draft.name).toBe('Olímpico de enero');
  });

  test('validation returns Spanish errors', () => {
    const base = initialRaceForm(null, TODAY);
    const badDate = validateRaceForm({ ...base, name: 'Sprint', date: '2027-13-45' });
    expect(badDate.ok).toBe(false);
    const ok = validateRaceForm({ ...base, name: 'Sprint de Gandía' });
    expect(ok.ok).toBe(true);
  });
});

describe('changesSeason', () => {
  const before = race({ id: 'r', date: '2027-04-18', distance: 'half', priority: 'A' });
  const draft = { name: 'Valencia', date: '2027-04-18', distance: 'half' as const, priority: 'A' as const, location: null, goal: null, notes: null };

  test('new upcoming races and new dates, distances or priorities reshape the season', () => {
    expect(changesSeason(null, draft, TODAY)).toBe(true);
    expect(changesSeason(before, { ...draft, date: '2027-05-02' }, TODAY)).toBe(true);
    expect(changesSeason(before, { ...draft, distance: 'full' }, TODAY)).toBe(true);
    expect(changesSeason(before, { ...draft, priority: 'B' }, TODAY)).toBe(true);
  });

  test('a new way to prepare a B/C race does, the default spelled out does not', () => {
    const b = race({ id: 'b', date: '2027-04-18', distance: 'olympic', priority: 'B' });
    const bDraft = { ...draft, distance: 'olympic' as const, priority: 'B' as const };
    expect(changesSeason(b, { ...bDraft, prep: 'specific' }, TODAY)).toBe(true);
    expect(changesSeason(b, { ...bDraft, prep: 'taper' }, TODAY)).toBe(false);
    expect(changesSeason(b, { ...bDraft, prep: null }, TODAY)).toBe(false);
  });

  test('renaming a race or saving a past one does not', () => {
    expect(changesSeason(before, { ...draft, name: 'Medio de Valencia' }, TODAY)).toBe(false);
    expect(changesSeason(null, { ...draft, date: '2020-01-01' }, TODAY)).toBe(false);
  });
});
