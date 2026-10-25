import { describe, expect, test } from '@jest/globals';

import {
  clampDuration,
  defaultTitle,
  initialForm,
  jointNewParams,
  normalizeTime,
  parseJointParams,
  prefillFromOpportunity,
  prefillFromSlot,
  toJointDraft,
  validateJointForm,
  type JointForm,
} from '../jointForm';
import type { Opportunity } from '../types';

import { ALEX } from './fixtures';

const TODAY = '2026-10-25';

function form(patch: Partial<JointForm> = {}): JointForm {
  return {
    inviteeIds: [ALEX],
    sport: 'run',
    title: 'Rodaje juntos',
    date: '2026-10-27',
    time: '18:30',
    durationMin: 60,
    intensity: 'endurance',
    location: '',
    notes: '',
    fromWorkoutId: null,
    ...patch,
  };
}

describe('normalizeTime', () => {
  test.each([
    ['18:30', '18:30'],
    ['9', '09:00'],
    ['930', '09:30'],
    ['1830', '18:30'],
    ['18.30', '18:30'],
    ['18h30', '18:30'],
    ['18h', '18:00'],
    [' 7:05 ', '07:05'],
  ])('parses %p as %p', (input, expected) => {
    expect(normalizeTime(input)).toBe(expected);
  });

  test('returns null for empty input and invalid for nonsense', () => {
    expect(normalizeTime('  ')).toBeNull();
    expect(normalizeTime('25:00')).toBe('invalid');
    expect(normalizeTime('18:75')).toBe('invalid');
    expect(normalizeTime('tarde')).toBe('invalid');
  });
});

describe('parseJointParams', () => {
  test('keeps valid params and drops invalid ones', () => {
    const parsed = parseJointParams({
      friendId: ALEX,
      date: '2026-10-31',
      sport: 'swim',
      startTime: '07:00',
      durationMin: '62',
      fromWorkoutId: 'w9',
      title: '  Piscina juntos  ',
    });
    expect(parsed).toEqual({
      friendId: ALEX,
      date: '2026-10-31',
      sport: 'swim',
      startTime: '07:00',
      durationMin: 60,
      fromWorkoutId: 'w9',
      title: 'Piscina juntos',
    });
  });

  test('ignores malformed values, rest sport and arrays use their first value', () => {
    const parsed = parseJointParams({ date: '31/10', sport: 'rest', startTime: '7pm', durationMin: 'x', friendId: [ALEX, 'other'] });
    expect(parsed.date).toBeUndefined();
    expect(parsed.sport).toBeUndefined();
    expect(parsed.startTime).toBeUndefined();
    expect(parsed.durationMin).toBeUndefined();
    expect(parsed.friendId).toBe(ALEX);
  });
});

describe('initialForm', () => {
  test('uses the prefilled friend only when accepted, else the single friend', () => {
    expect(initialForm({ friendId: ALEX }, TODAY, [ALEX, 'b']).inviteeIds).toEqual([ALEX]);
    expect(initialForm({ friendId: 'stranger' }, TODAY, [ALEX]).inviteeIds).toEqual([ALEX]);
    expect(initialForm({ friendId: 'stranger' }, TODAY, [ALEX, 'b']).inviteeIds).toEqual([]);
  });

  test('defaults title by sport and moves past dates to today', () => {
    const initial = initialForm({ sport: 'bike', date: '2026-10-01' }, TODAY, []);
    expect(initial.title).toBe(defaultTitle('bike'));
    expect(initial.date).toBe(TODAY);
    expect(initial.durationMin).toBe(60);
    expect(initial.time).toBe('');
  });
});

describe('validateJointForm', () => {
  test('accepts a complete form', () => {
    expect(validateJointForm(form(), TODAY)).toBeNull();
    expect(validateJointForm(form({ time: '' }), TODAY)).toBeNull();
  });

  test.each<[Partial<JointForm>, string]>([
    [{ inviteeIds: [] }, 'Elige al menos un amigo para invitar.'],
    [{ title: '   ' }, 'Ponle un título a la quedada.'],
    [{ title: 'x'.repeat(121) }, 'El título es demasiado largo.'],
    [{ date: '2026-10-20' }, 'La quedada no puede ser en el pasado.'],
    [{ date: 'mañana' }, 'Elige un día.'],
    [{ time: '27:00' }, 'La hora debe tener el formato 18:30.'],
    [{ durationMin: 5 }, 'La duración debe estar entre 15 minutos y 8 horas.'],
    [{ location: 'x'.repeat(201) }, 'El lugar es demasiado largo.'],
    [{ notes: 'x'.repeat(2001) }, 'Las notas son demasiado largas.'],
  ])('rejects %p', (patch, message) => {
    expect(validateJointForm(form(patch), TODAY)).toBe(message);
  });
});

describe('toJointDraft', () => {
  test('normalises time, trims text and nulls empty optionals', () => {
    const draft = toJointDraft(form({ time: '930', title: ' Rodaje ', location: '  ', notes: ' traer geles ', fromWorkoutId: 'w1' }));
    expect(draft).toEqual({
      sport: 'run',
      date: '2026-10-27',
      startTime: '09:30',
      durationMin: 60,
      intensity: 'endurance',
      title: 'Rodaje',
      location: null,
      notes: 'traer geles',
      inviteeIds: [ALEX],
      fromWorkoutId: 'w1',
    });
  });

  test('empty time means no start time and does not share the invitee array', () => {
    const source = form({ time: '' });
    const draft = toJointDraft(source);
    expect(draft.startTime).toBeNull();
    expect(draft.inviteeIds).not.toBe(source.inviteeIds);
  });
});

describe('prefills and params', () => {
  const opportunity: Opportunity = {
    id: 'o1',
    date: '2026-10-31',
    sport: 'run',
    kind: 'same_session',
    myWorkoutId: 'w1',
    friendItemId: 'fi1',
    start: '09:00',
    durationMin: 100,
    score: 0.9,
    title: 'Rodaje juntos',
    reason: 'Los dos tenéis carrera el sáb 31 oct: ¿lo hacéis juntos?',
  };

  test('builds a prefill from an opportunity', () => {
    expect(prefillFromOpportunity(opportunity, ALEX)).toEqual({
      friendId: ALEX,
      date: '2026-10-31',
      sport: 'run',
      startTime: '09:00',
      durationMin: 100,
      fromWorkoutId: 'w1',
      title: 'Rodaje juntos',
    });
    expect(prefillFromOpportunity({ ...opportunity, start: null, myWorkoutId: null }, ALEX).startTime).toBeUndefined();
  });

  test('builds a prefill from a slot capped at one hour', () => {
    expect(prefillFromSlot({ date: '2026-10-28', start: '19:00', end: '21:30', minutes: 150 }, ALEX)).toEqual({
      friendId: ALEX,
      date: '2026-10-28',
      startTime: '19:00',
      durationMin: 60,
    });
    expect(prefillFromSlot({ date: '2026-10-28', start: '19:00', end: '19:45', minutes: 45 }, ALEX).durationMin).toBe(45);
  });

  test('serialises only defined values', () => {
    expect(jointNewParams({ friendId: ALEX, durationMin: 45, startTime: undefined })).toEqual({ friendId: ALEX, durationMin: '45' });
  });

  test('clampDuration rounds to 5 and clamps', () => {
    expect(clampDuration(62)).toBe(60);
    expect(clampDuration(3)).toBe(15);
    expect(clampDuration(9999)).toBe(480);
    expect(clampDuration(Number.NaN)).toBe(60);
  });
});
