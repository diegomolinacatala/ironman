import { describe, expect, test } from '@jest/globals';

import type { DailyCheckin } from '@/domain/types';
import { checkinDraftSchema } from '@/domain/validation';

import {
  DEFAULT_SLEEP_HOURS,
  NORMAL_SCORES,
  checkinToForm,
  fillUnanswered,
  formToCheckinDraft,
  roundHalf,
  sleepHoursLabel,
  sleepQualityFromScore,
  unansweredCount,
} from '../checkinForm';

const existing: DailyCheckin = {
  userId: 'me',
  date: '2026-10-25',
  sleepQuality: 4,
  sleepHours: 6.5,
  fatigue: 3,
  soreness: 2,
  stress: 4,
  motivation: 5,
  notes: 'Bien',
};

describe('check-in form', () => {
  test('prefills from an existing check-in', () => {
    const form = checkinToForm('2026-10-25', existing, 8.2);
    expect(form).toMatchObject({ sleepQuality: 4, sleepHours: 6.5, stress: 4, notes: 'Bien' });
  });

  test('new check-in uses the device sleep hint rounded to half hours', () => {
    expect(checkinToForm('2026-10-25', null, 7.3).sleepHours).toBe(7.5);
    expect(checkinToForm('2026-10-25', null, null).sleepHours).toBe(DEFAULT_SLEEP_HOURS);
    expect(checkinToForm('2026-10-25', null, null).fatigue).toBeNull();
  });

  test('draft is null until every score is answered', () => {
    const empty = checkinToForm('2026-10-25', null, null);
    expect(formToCheckinDraft(empty)).toBeNull();
    const full = { ...empty, sleepQuality: 3, fatigue: 2, soreness: 1, stress: 2, motivation: 4, notes: '  ' } as const;
    const draft = formToCheckinDraft(full);
    expect(draft).toMatchObject({ sleepQuality: 3, notes: null, sleepHours: DEFAULT_SLEEP_HOURS });
    expect(checkinDraftSchema.safeParse(draft).success).toBe(true);
  });

  test('the watch sleep score answers the sleep quality row of a new check-in', () => {
    expect(checkinToForm('2026-10-25', null, 7, 82).sleepQuality).toBe(4);
    expect(checkinToForm('2026-10-25', null, 7, null).sleepQuality).toBeNull();
    // An existing answer always wins.
    expect(checkinToForm('2026-10-25', existing, 7, 30).sleepQuality).toBe(4);
    expect([95, 75, 60, 40, 10, 0].map(sleepQualityFromScore)).toEqual([5, 4, 3, 2, 1, null]);
  });

  test('"Todo normal" and "Como ayer" fill only the rows still empty', () => {
    const form = { ...checkinToForm('2026-10-26', null, 7, 92), fatigue: 4 as const };
    expect(unansweredCount(form)).toBe(3);
    const normal = fillUnanswered(form, NORMAL_SCORES);
    expect(normal).toMatchObject({ sleepQuality: 5, fatigue: 4, soreness: 3, stress: 3, motivation: 3 });
    expect(unansweredCount(normal)).toBe(0);
    expect(formToCheckinDraft(normal)).not.toBeNull();
    const asYesterday = fillUnanswered(form, existing);
    expect(asYesterday).toMatchObject({ sleepQuality: 5, fatigue: 4, soreness: 2, stress: 4, motivation: 5 });
    expect(asYesterday.notes).toBe('');
  });

  test('helpers', () => {
    expect(roundHalf(6.74)).toBe(6.5);
    expect(roundHalf(6.76)).toBe(7);
    expect(sleepHoursLabel(7.5)).toBe('7,5 h');
  });
});
