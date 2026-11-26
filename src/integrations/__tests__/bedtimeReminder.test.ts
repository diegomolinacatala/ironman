import { describe, expect, test } from '@jest/globals';

import { bedtimeReminderOf } from '@/features/stress/useBedtimeReminder';
import { stressSignal } from '@/features/stress/__tests__/stressFixtures';

import { BREATHING_URL, bedtimeReminderSpec, buildSchedule, isLocalNotificationKind, type NotificationSpec } from '../notifications/schedule';
import { prefs } from './fixtures';

const TODAY = '2026-10-26';
const MORNING = new Date(2026, 9, 26, 8, 0);
const reminder = { date: TODAY, usualBedtimeMin: 23 * 60, headline: 'Estrés alto 2 días y dormiste 1 h menos de lo habitual' };

function dateOf(spec: NotificationSpec | null | undefined): Date {
  if (!spec || spec.trigger.type !== 'date') throw new Error('expected a date trigger');
  return spec.trigger.date;
}

describe('bedtime reminder («Hoy toca acostarse antes»)', () => {
  test('45 min before the usual bedtime, with the reason, the earlier bedtime and breathing', () => {
    const spec = bedtimeReminderSpec(reminder, MORNING);
    expect(dateOf(spec)).toEqual(new Date(2026, 9, 26, 22, 15));
    expect(spec).toMatchObject({
      id: `rti.bedtime.${TODAY}`,
      kind: 'bedtime',
      title: 'Hoy toca acostarse antes',
      body: 'Estrés alto 2 días y dormiste 1 h menos de lo habitual. A la cama sobre las 22:30; antes, 3 minutos de respiración lenta.',
      url: BREATHING_URL,
      categoryId: 'calm',
    });
    expect(isLocalNotificationKind('bedtime')).toBe(true);
  });

  test('a usual bedtime after midnight fires that night, not the morning before', () => {
    const spec = bedtimeReminderSpec({ ...reminder, usualBedtimeMin: 30 }, MORNING);
    expect(dateOf(spec)).toEqual(new Date(2026, 9, 26, 23, 45));
    expect(spec?.body).toContain('sobre las 00:00');
  });

  test('only on flagged days, never in the past, and the toggle turns it off', () => {
    const kinds = (input: Partial<Parameters<typeof buildSchedule>[0]>) =>
      buildSchedule({ workouts: [], prefs, today: TODAY, now: MORNING, ...input }).map((s) => s.kind);
    expect(kinds({})).not.toContain('bedtime');
    expect(kinds({ bedtime: reminder })).toContain('bedtime');
    expect(kinds({ bedtime: reminder, now: new Date(2026, 9, 26, 22, 30) })).not.toContain('bedtime');
    expect(kinds({ bedtime: reminder, prefs: { ...prefs, bedtimeReminder: false } })).not.toContain('bedtime');
    expect(kinds({ bedtime: reminder, prefs: { ...prefs, bedtimeReminder: true } })).toContain('bedtime');
  });

  test('built from the stress-and-sleep signal (none without it)', () => {
    expect(bedtimeReminderOf(null)).toBeNull();
    expect(bedtimeReminderOf(stressSignal(TODAY, { usualBedtimeMin: 23 * 60 + 30 }))).toEqual({
      date: TODAY,
      usualBedtimeMin: 23 * 60 + 30,
      headline: 'Estrés alto 2 días y dormiste 1 h menos de lo habitual',
    });
  });
});
