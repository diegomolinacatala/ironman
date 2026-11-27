import { describe, expect, test } from '@jest/globals';

import { DEFAULT_HABITS } from '@/domain/habitCatalog';
import type { DailyCheckin, HabitId } from '@/domain/types';
import { checkinDraftSchema } from '@/domain/validation';

import { DEFAULT_SLEEP_HOURS, answeredCount, checkinToForm, formToCheckinDraft, hasScales, roundHalf, sleepHoursLabel } from '../checkinForm';

const QUESTIONS: HabitId[] = [...DEFAULT_HABITS];

const existing: DailyCheckin = {
  userId: 'me',
  date: '2026-10-25',
  sleepQuality: 4,
  sleepHours: 6.5,
  fatigue: 3,
  soreness: 2,
  stress: 4,
  motivation: 5,
  habits: { alcohol: true, niggle: false },
  notes: 'Bien',
};

const allNo = Object.fromEntries(QUESTIONS.map((id) => [id, false]));

describe('check-in form', () => {
  test('prefills from an existing check-in, journal answers included', () => {
    const form = checkinToForm('2026-10-25', existing, 8.2, QUESTIONS);
    expect(form).toMatchObject({ sleepQuality: 4, sleepHours: 6.5, stress: 4, notes: 'Bien', habits: { alcohol: true, niggle: false } });
    expect(form.questions).toEqual(QUESTIONS);
    expect(answeredCount(form)).toBe(2);
    expect(hasScales(form)).toBe(true);
  });

  test('new check-in uses the device sleep hint rounded to half hours; scales start empty', () => {
    expect(checkinToForm('2026-10-25', null, 7.3, QUESTIONS).sleepHours).toBe(7.5);
    expect(checkinToForm('2026-10-25', null, null, QUESTIONS).sleepHours).toBe(DEFAULT_SLEEP_HOURS);
    const fresh = checkinToForm('2026-10-25', null, null, QUESTIONS);
    expect(fresh.fatigue).toBeNull();
    expect(hasScales(fresh)).toBe(false);
  });

  test('draft is null until every yes/no question is answered; the 1–5 scales are optional', () => {
    const empty = checkinToForm('2026-10-25', null, null, QUESTIONS);
    expect(formToCheckinDraft(empty)).toBeNull();
    expect(formToCheckinDraft({ ...empty, habits: { alcohol: true } })).toBeNull();
    const journalOnly = formToCheckinDraft({ ...empty, habits: allNo, notes: '  ' });
    expect(journalOnly).toMatchObject({ habits: allNo, fatigue: null, notes: null, sleepHours: DEFAULT_SLEEP_HOURS });
    expect(checkinDraftSchema.safeParse(journalOnly).success).toBe(true);
    const full = formToCheckinDraft({ ...empty, habits: allNo, sleepQuality: 3, fatigue: 2, soreness: 1, stress: 2, motivation: 4 });
    expect(full).toMatchObject({ sleepQuality: 3, fatigue: 2 });
    expect(checkinDraftSchema.safeParse(full).success).toBe(true);
  });

  test('answers to habits no longer asked are kept', () => {
    const form = checkinToForm('2026-10-25', { ...existing, habits: { ...allNo, sauna: true } }, null, QUESTIONS);
    expect(formToCheckinDraft(form)?.habits.sauna).toBe(true);
  });

  test('the schema rejects unknown habits and non-boolean answers', () => {
    const base = formToCheckinDraft({ ...checkinToForm('2026-10-25', null, null, QUESTIONS), habits: allNo });
    expect(checkinDraftSchema.safeParse({ ...base, habits: { beer: true } }).success).toBe(false);
    expect(checkinDraftSchema.safeParse({ ...base, habits: { alcohol: 'sí' } }).success).toBe(false);
  });

  test('helpers', () => {
    expect(roundHalf(6.74)).toBe(6.5);
    expect(roundHalf(6.76)).toBe(7);
    expect(sleepHoursLabel(7.5)).toBe('7,5 h');
  });
});
