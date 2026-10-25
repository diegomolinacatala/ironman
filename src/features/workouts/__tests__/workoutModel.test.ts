import { describe, expect, test } from '@jest/globals';

import { workoutDraftSchema } from '@/domain/validation';

import { weekComplianceState } from '../complianceMeta';
import {
  formatDistanceInput,
  jointNewHref,
  parseDistanceInput,
  partnerNameFor,
  workoutToDraft,
} from '../draft';
import { addStep, applyTemplate, changeSport, emptyForm, formToDraft, isSport, removeStep, updateStep, workoutToForm } from '../form';
import { timeRangeLabel, workoutMetaLine } from '../format';
import { isRpe, rpeLabel } from '../rpe';
import { stepLabel, stepSegments, stepWeight, stepsTotalMinutes } from '../steps';
import { allTemplates, templatesFor } from '../templates';
import { ALEX, ME, makeSession, makeWorkout } from './fixtures';

describe('distance input', () => {
  test('parses km with comma or dot, metres for swim', () => {
    expect(parseDistanceInput('21,1', 'run')).toBe(21100);
    expect(parseDistanceInput('10.5', 'bike')).toBe(10500);
    expect(parseDistanceInput('2500', 'swim')).toBe(2500);
    expect(parseDistanceInput('', 'run')).toBeNull();
    expect(parseDistanceInput('-3', 'run')).toBeNull();
    expect(parseDistanceInput('abc', 'run')).toBeNull();
  });

  test('formats metres back to the sport unit', () => {
    expect(formatDistanceInput(21100, 'run')).toBe('21,1');
    expect(formatDistanceInput(2500, 'swim')).toBe('2500');
    expect(formatDistanceInput(null, 'run')).toBe('');
    expect(formatDistanceInput(0, 'bike')).toBe('');
  });
});

describe('partners', () => {
  test('names the other non-declined participants', () => {
    const w = makeWorkout({ jointSessionId: 's1' });
    expect(partnerNameFor(w, [makeSession()], ME)).toBe('Álex');
    expect(partnerNameFor(makeWorkout(), [makeSession()], ME)).toBeNull();
    expect(partnerNameFor(w, [makeSession({ status: 'cancelled' })], ME)).toBeNull();
    expect(partnerNameFor(w, [], ME)).toBe('tu grupo');
  });

  test('joins several partners', () => {
    const session = makeSession({
      participants: [
        { userId: ME, displayName: 'Diego', avatarUrl: null, status: 'accepted', workoutId: 'w1' },
        { userId: ALEX, displayName: 'Álex', avatarUrl: null, status: 'accepted', workoutId: null },
        { userId: 'm', displayName: 'Marta López', avatarUrl: null, status: 'invited', workoutId: null },
        { userId: 'n', displayName: 'Nacho', avatarUrl: null, status: 'declined', workoutId: null },
      ],
    });
    expect(partnerNameFor(makeWorkout({ jointSessionId: 's1' }), [session], ME)).toBe('Álex y Marta');
  });
});

describe('drafts and links', () => {
  test('workoutToDraft copies fields as a manual draft with overrides', () => {
    const w = makeWorkout({ steps: [{ kind: 'work', durationMin: 10 }], isKey: true, source: 'rules' });
    const draft = workoutToDraft(w, { date: '2026-10-27' });
    expect(draft).toMatchObject({ date: '2026-10-27', title: 'Rodaje', isKey: true, source: 'manual' });
    expect(draft.steps).not.toBe(w.steps);
    expect(draft.steps?.[0]).not.toBe(w.steps[0]);
  });

  test('jointNewHref encodes the workout', () => {
    const href = jointNewHref(makeWorkout({ id: 'abc', title: 'Series 6×1000', startTime: '18:30' }));
    expect(href.startsWith('/joint/new?')).toBe(true);
    expect(href).toContain('fromWorkoutId=abc');
    expect(href).toContain(`title=${encodeURIComponent('Series 6×1000')}`);
    expect(href).toContain('startTime=18%3A30');
    expect(jointNewHref(makeWorkout())).not.toContain('startTime');
  });
});

describe('form', () => {
  test('empty form defaults by sport', () => {
    expect(emptyForm('2026-10-27', 'bike')).toMatchObject({ sport: 'bike', durationMin: 60, intensity: 'endurance' });
    expect(emptyForm('2026-10-27', 'rest')).toMatchObject({ durationMin: 0, intensity: 'recovery' });
  });

  test('changeSport resets untouched duration but keeps edited ones', () => {
    const base = emptyForm('2026-10-27', 'run');
    expect(changeSport(base, 'bike').durationMin).toBe(60);
    expect(changeSport({ ...base, durationMin: 70 }, 'bike').durationMin).toBe(70);
    expect(changeSport({ ...base, distance: '10' }, 'swim').distance).toBe('');
  });

  test('templates fill the form and produce valid drafts', () => {
    for (const t of allTemplates()) {
      const state = applyTemplate(emptyForm('2026-10-27', t.sport), t);
      const draft = formToDraft(state, 'manual');
      expect(workoutDraftSchema.safeParse(draft).success).toBe(true);
    }
    expect(templatesFor('swim').map((t) => t.title)).toEqual(['Técnica 2.000 m', 'CSS 10×100']);
  });

  test('workoutToForm → formToDraft round-trips', () => {
    const w = makeWorkout({ distanceM: 10000, description: 'Suave', startTime: '07:00' });
    const draft = formToDraft(workoutToForm(w));
    expect(draft).toMatchObject({ distanceM: 10000, description: 'Suave', startTime: '07:00', title: 'Rodaje' });
    expect(draft.source).toBeUndefined();
  });

  test('step editing is immutable', () => {
    const steps = addStep([], 'threshold');
    expect(steps[0]).toMatchObject({ kind: 'warmup', intensity: 'recovery' });
    const two = addStep(steps, 'threshold');
    expect(two[1]).toMatchObject({ kind: 'work', intensity: 'threshold' });
    const updated = updateStep(two, 1, { repeat: 6 });
    expect(updated[1]?.repeat).toBe(6);
    expect(two[1]?.repeat).toBeUndefined();
    expect(removeStep(updated, 0)).toHaveLength(1);
  });

  test('isSport guards params', () => {
    expect(isSport('swim')).toBe(true);
    expect(isSport('padel')).toBe(false);
    expect(isSport(undefined)).toBe(false);
  });
});

describe('steps', () => {
  test('weights by minutes × repeats with a distance fallback', () => {
    expect(stepWeight({ kind: 'work', durationMin: 4, repeat: 6 })).toBe(24);
    expect(stepWeight({ kind: 'work', distanceM: 100, repeat: 10 })).toBe(20);
    expect(stepWeight({ kind: 'rest' })).toBe(1);
  });

  test('labels and segments', () => {
    expect(stepLabel({ kind: 'work', durationMin: 4, repeat: 6 }, 'run')).toBe("6× 4' · Trabajo");
    expect(stepLabel({ kind: 'warmup', distanceM: 400 }, 'swim')).toBe('400 m · Calentamiento');
    const segments = stepSegments([{ kind: 'warmup', durationMin: 10 }, { kind: 'work', durationMin: 20 }], 'tempo', 'bike');
    expect(segments.map((s) => s.intensity)).toEqual(['recovery', 'tempo']);
  });

  test('total minutes only when every step is timed', () => {
    expect(stepsTotalMinutes([{ kind: 'work', durationMin: 4, repeat: 6 }, { kind: 'cooldown', durationMin: 6 }])).toBe(30);
    expect(stepsTotalMinutes([{ kind: 'work', distanceM: 100 }])).toBeNull();
    expect(stepsTotalMinutes([])).toBeNull();
  });
});

describe('format', () => {
  test('meta line and time range', () => {
    const w = makeWorkout({ startTime: '18:30', durationMin: 75, distanceM: 12000 });
    expect(workoutMetaLine(w)).toBe("18:30 · 1h 15' · 12 km");
    expect(timeRangeLabel(w)).toBe('18:30–19:45');
    expect(timeRangeLabel(makeWorkout())).toBeNull();
    expect(timeRangeLabel(makeWorkout({ startTime: '23:30', durationMin: 60 }))).toBe('23:30–00:30');
  });

  test('completed workouts show real numbers', () => {
    const w = makeWorkout({ status: 'completed', completed: { durationMin: 50 } });
    expect(workoutMetaLine(w)).toBe("50'");
  });
});

describe('rpe and compliance bands', () => {
  test('rpe labels and guard', () => {
    expect(rpeLabel(1)).toBe('Muy suave');
    expect(rpeLabel(7)).toBe('Duro');
    expect(rpeLabel(10)).toBe('Al límite');
    expect(isRpe(5)).toBe(true);
    expect(isRpe(11)).toBe(false);
    expect(isRpe(2.5)).toBe(false);
  });

  test('week compliance bands', () => {
    expect(weekComplianceState(null)).toBe('pending');
    expect(weekComplianceState(0.9)).toBe('done');
    expect(weekComplianceState(0.6)).toBe('partial');
    expect(weekComplianceState(0.3)).toBe('off');
  });
});
