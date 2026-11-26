import { describe, expect, test } from '@jest/globals';

import type { DailyCheckin } from '@/domain/types';
import { checkinDraftSchema } from '@/domain/validation';

import { DEFAULT_SLEEP_HOURS, checkinToForm, formToCheckinDraft, missingIllnessAnswer, roundHalf, sleepHoursLabel } from '../checkinForm';

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

  test('the illness question, when shown, needs an answer that travels with the draft', () => {
    const asked = { ...checkinToForm('2026-10-25', null, null, true), sleepQuality: 3, fatigue: 2, soreness: 1, stress: 2, motivation: 4 } as const;
    expect(missingIllnessAnswer(asked)).toBe(true);
    expect(formToCheckinDraft(asked)).toBeNull();
    const answered = formToCheckinDraft({ ...asked, illnessAnswer: 'heat' });
    expect(answered).toMatchObject({ illnessAnswer: 'heat' });
    expect(checkinDraftSchema.safeParse(answered).success).toBe(true);
    const notAsked = formToCheckinDraft({ ...asked, illnessAsked: false });
    expect(notAsked && 'illnessAnswer' in notAsked).toBe(false);
  });

  test('an earlier answer stays editable even if the signal is gone', () => {
    const form = checkinToForm('2026-10-25', { ...existing, illnessAnswer: 'symptoms' }, null, false);
    expect(form).toMatchObject({ illnessAsked: true, illnessAnswer: 'symptoms' });
  });

  test('helpers', () => {
    expect(roundHalf(6.74)).toBe(6.5);
    expect(roundHalf(6.76)).toBe(7);
    expect(sleepHoursLabel(7.5)).toBe('7,5 h');
  });
});
