/** The weekly planner while stress is costing the athlete sleep (domain/stressSleep.ts). */
import { planWeek, type PlannerInput } from '../planner';
import type { Availability } from '../types';
import { makeEvent, makeProfile, makeRace } from './fixtures';

const AUTO: Availability = { mode: 'auto', weeklyHoursTarget: 0, restDay: null, longSessionDays: [5, 6], windows: [], poolDays: [] };
/** Base weeks towards a 70.3 in June: 2026-11-30 is a load week, 2026-12-14 the descarga. */
const LOAD_WEEK = '2026-11-30';
const RECOVERY_WEEK = '2026-12-14';

function athlete(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    weekStart: LOAD_WEEK,
    profile: makeProfile({ availability: AUTO }),
    races: [makeRace({ date: '2027-06-13', distance: 'half' })],
    existing: [],
    lifeEvents: [],
    busyBlocks: [],
    jointSessions: [],
    recentWeeklyMinutes: [480, 480, 480, 480],
    ...overrides,
  };
}

describe('planner with the stress-and-sleep signal', () => {
  test('a moderate signal takes the week about 10 % down and says why', () => {
    const calm = planWeek(athlete());
    const stressed = planWeek(athlete({ stressSleep: { level: 'moderate' } }));
    expect(stressed.targetMinutes).toBeLessThanOrEqual(Math.round(calm.targetMinutes * 0.9) + 1);
    expect(stressed.summary).toContain('Estrés alto y peor sueño estos días: la semana va un 10 % más suave');
  });

  test('a high signal cuts more than a moderate one', () => {
    const moderate = planWeek(athlete({ stressSleep: { level: 'moderate' } }));
    const high = planWeek(athlete({ stressSleep: { level: 'high' } }));
    expect(high.targetMinutes).toBeLessThan(moderate.targetMinutes);
    expect(high.summary).toContain('15 % más suave');
  });

  test('in an exam week it adds 10 % to the exam cut', () => {
    const exam = makeEvent({ kind: 'exam', title: 'Examen', startDate: '2026-12-02', endDate: '2026-12-02', severity: 2, durationMin: null });
    const examOnly = planWeek(athlete({ lifeEvents: [exam] }));
    const both = planWeek(athlete({ lifeEvents: [exam], stressSleep: { level: 'high' } }));
    expect(both.targetMinutes).toBeLessThanOrEqual(Math.round(examOnly.targetMinutes * 0.9) + 1);
    expect(both.summary).toContain('Semana de exámenes');
    expect(both.summary).toContain('10 % más suave');
  });

  test('a descarga is not cut again', () => {
    const descarga = planWeek(athlete({ weekStart: RECOVERY_WEEK }));
    const stressed = planWeek(athlete({ weekStart: RECOVERY_WEEK, stressSleep: { level: 'high' } }));
    expect(stressed.phase.isRecoveryWeek).toBe(true);
    expect(stressed.targetMinutes).toBeLessThanOrEqual(descarga.targetMinutes);
    expect(stressed.summary).not.toContain('peor sueño');
  });
});
