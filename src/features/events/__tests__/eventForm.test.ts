import { describe, expect, test } from '@jest/globals';

import { lifeEventLabel } from '@/domain/labels';
import { LIFE_EVENT_KINDS } from '@/domain/types';
import { lifeEventDraftSchema } from '@/domain/validation';
import { makeEvent } from '@/features/workouts/__tests__/fixtures';

import {
  changeKind,
  changeStartDate,
  emptyEventForm,
  eventToForm,
  formToEventDraft,
  isBodyArea,
  isLifeEventKind,
} from '../eventForm';
import { hasTime, isSeverity, kindGroup, lifeEventIcon } from '../kinds';

describe('kinds', () => {
  test('groups and icons cover every kind', () => {
    for (const kind of LIFE_EVENT_KINDS) {
      expect(lifeEventIcon(kind)).toBeTruthy();
      expect(['sport', 'injury', 'range']).toContain(kindGroup(kind));
    }
    expect(kindGroup('football')).toBe('sport');
    expect(kindGroup('injury')).toBe('injury');
    expect(kindGroup('travel')).toBe('range');
    expect(hasTime('social')).toBe(true);
    expect(hasTime('illness')).toBe(false);
    expect(isSeverity(2)).toBe(true);
    expect(isSeverity(4)).toBe(false);
  });
});

describe('event form', () => {
  test('sport draft is a single timed day with duration', () => {
    const state = { ...emptyEventForm('2026-10-28', 'padel'), endDate: '2026-10-30' };
    const draft = formToEventDraft(state, lifeEventLabel);
    expect(draft).toMatchObject({ kind: 'padel', endDate: '2026-10-28', startTime: '19:00', durationMin: 90, bodyArea: null });
    expect(draft.title).toBe(lifeEventLabel('padel'));
    expect(lifeEventDraftSchema.safeParse(draft).success).toBe(true);
  });

  test('injury keeps the range and body area, drops time/duration', () => {
    const base = changeKind(emptyEventForm('2026-10-26', 'padel'), 'injury');
    expect(base.startTime).toBeNull();
    const draft = formToEventDraft({ ...base, endDate: '2026-10-30', bodyArea: 'knee', severity: 3, title: '  Rodilla ' }, lifeEventLabel);
    expect(draft).toMatchObject({ kind: 'injury', startDate: '2026-10-26', endDate: '2026-10-30', bodyArea: 'knee', durationMin: null, startTime: null, title: 'Rodilla' });
    expect(lifeEventDraftSchema.safeParse(draft).success).toBe(true);
  });

  test('injury without body area fails validation', () => {
    const draft = formToEventDraft(changeKind(emptyEventForm('2026-10-26'), 'injury'), lifeEventLabel);
    expect(lifeEventDraftSchema.safeParse(draft).success).toBe(false);
  });

  test('changeKind clears body area when leaving injury', () => {
    const injury = { ...changeKind(emptyEventForm('2026-10-26'), 'injury'), bodyArea: 'calf' as const };
    expect(changeKind(injury, 'stress').bodyArea).toBeNull();
    expect(changeKind(injury, 'football').startTime).toBe('19:00');
  });

  test('changeStartDate keeps the end on or after the start', () => {
    const range = { ...changeKind(emptyEventForm('2026-10-26'), 'travel'), endDate: '2026-10-28' };
    expect(changeStartDate(range, '2026-10-27').endDate).toBe('2026-10-28');
    expect(changeStartDate(range, '2026-10-30').endDate).toBe('2026-10-30');
    const sport = emptyEventForm('2026-10-26', 'padel');
    expect(changeStartDate(sport, '2026-10-29').endDate).toBe('2026-10-29');
  });

  test('eventToForm hides default titles and round-trips', () => {
    const e = makeEvent({ title: lifeEventLabel('padel'), notes: 'con amigos' });
    const form = eventToForm(e, lifeEventLabel);
    expect(form.title).toBe('');
    expect(formToEventDraft(form, lifeEventLabel)).toMatchObject({ title: lifeEventLabel('padel'), notes: 'con amigos', durationMin: 90 });
    expect(eventToForm(makeEvent({ title: 'Final del torneo' }), lifeEventLabel).title).toBe('Final del torneo');
  });

  test('param guards', () => {
    expect(isLifeEventKind('exam')).toBe(true);
    expect(isLifeEventKind('swim')).toBe(false);
    expect(isBodyArea('knee')).toBe(true);
    expect(isBodyArea('elbow')).toBe(false);
  });
});
