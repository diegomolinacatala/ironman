/// <reference types="jest" />
import type { CoachRequest, LifeEvent, LifeEventDraft, PlanChange } from '@/domain/types';

import { lifeEventsAffectingWeek, targetWeekStart } from '../demo/rulesCoach';
import type { DemoRepository } from '../demo/DemoRepository';
import { resetStorage, signedInRepo } from './demoTestUtils';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

beforeEach(resetStorage);

/** Empty future week of the demo (today is Sun 25 Oct 2026). */
const EMPTY_WEEK = '2026-11-09';
const TODAY = '2026-10-25';
const TRAINING = new Set(['swim', 'bike', 'run', 'brick', 'strength']);

function event(partial: Partial<LifeEvent> & Pick<LifeEvent, 'startDate' | 'endDate'>): LifeEvent {
  return {
    id: 'e1',
    userId: 'me',
    kind: 'padel',
    title: 'Pádel',
    startTime: null,
    durationMin: 90,
    severity: 2,
    bodyArea: null,
    notes: null,
    createdAt: '2026-10-25T10:00:00.000Z',
    ...partial,
  };
}

function adds(changes: readonly PlanChange[] | undefined) {
  return (changes ?? []).flatMap((c) => (c.op === 'add' ? [c.workout] : []));
}

async function planWith(repo: DemoRepository, draft: LifeEventDraft) {
  await repo.createLifeEvent(draft);
  return repo.requestCoach({ mode: 'plan_week', weekStart: EMPTY_WEEK });
}

describe('rules coach: life events that ended before the week still count', () => {
  it('blocks training after cardiac warning signs that ended before the week', async () => {
    const repo = await signedInRepo();
    const response = await planWith(repo, {
      kind: 'illness',
      title: 'Palpitaciones y mareo',
      startDate: '2026-11-06',
      endDate: '2026-11-07',
      severity: 2,
    });
    expect(adds(response.proposal?.changes).filter((w) => TRAINING.has(w.sport))).toEqual([]);
    await repo.store.dispose();
  });

  it('keeps the 7-day easy-running window of a mild knee injury logged on the Saturday before', async () => {
    const repo = await signedInRepo();
    const response = await planWith(repo, {
      kind: 'injury',
      title: 'Molestia en la rodilla',
      startDate: '2026-11-07',
      severity: 1,
      bodyArea: 'knee',
    });
    const planned = adds(response.proposal?.changes);
    expect(planned.length).toBeGreaterThan(0);
    const restrictedRuns = planned.filter((w) => (w.sport === 'run' || w.sport === 'brick') && w.date <= '2026-11-13');
    expect(restrictedRuns.filter((w) => w.intensity !== 'recovery' && w.intensity !== 'endurance')).toEqual([]);
    await repo.store.dispose();
  });

  it('passes events that end up to 14 days before the week (and a week after it)', () => {
    const events = [
      event({ id: 'old', startDate: '2026-10-20', endDate: '2026-10-25' }),
      event({ id: 'recent', startDate: '2026-10-27', endDate: '2026-10-28' }),
      event({ id: 'inside', startDate: '2026-11-10', endDate: '2026-11-10' }),
      event({ id: 'next', startDate: '2026-11-20', endDate: '2026-11-20' }),
      event({ id: 'far', startDate: '2026-11-24', endDate: '2026-11-24' }),
    ];
    expect(lifeEventsAffectingWeek(events, EMPTY_WEEK).map((e) => e.id)).toEqual(['recent', 'inside', 'next']);
  });
});

describe('rules coach: event re-plan of a future week', () => {
  it('re-plans the week of the event with today = its Monday', async () => {
    const repo = await signedInRepo();
    const padel = await repo.createLifeEvent({
      kind: 'padel',
      title: 'Pádel con el trabajo',
      startDate: '2026-10-27',
      startTime: '19:00',
      durationMin: 90,
      severity: 2,
    });
    const clash = await repo.createWorkout({ date: '2026-10-27', startTime: '19:00', sport: 'run', title: 'Series en pista', durationMin: 50, intensity: 'threshold' });
    const after = await repo.createWorkout({ date: '2026-10-28', startTime: '07:00', sport: 'run', title: 'Umbral', durationMin: 50, intensity: 'threshold' });

    // `/coach?mode=replan&lifeEventId=…` defaults weekStart to the current week.
    const response = await repo.requestCoach({ mode: 'replan', weekStart: '2026-10-19', lifeEventId: padel.id });
    expect(response.proposal).not.toBeNull();
    expect(response.proposal?.weekStart).toBe('2026-10-26');
    const touched = (response.proposal?.changes ?? []).flatMap((c) => (c.op === 'add' ? [] : [c.workoutId]));
    expect(touched).toEqual(expect.arrayContaining([clash.id]));
    expect(touched.includes(clash.id) || touched.includes(after.id)).toBe(true);
    await repo.store.dispose();
  });

  it('targets the event week unless the requested week overlaps it', () => {
    const base: CoachRequest = { mode: 'replan', weekStart: '2026-10-19' };
    const future = event({ startDate: '2026-10-27', endDate: '2026-10-27' });
    const ongoing = event({ startDate: '2026-10-21', endDate: '2026-11-03' });
    const past = event({ startDate: '2026-10-10', endDate: '2026-10-11' });
    expect(targetWeekStart(base, TODAY, null)).toBe('2026-10-19');
    expect(targetWeekStart(base, TODAY, future)).toBe('2026-10-26');
    expect(targetWeekStart({ ...base, weekStart: '2026-10-26' }, TODAY, ongoing)).toBe('2026-10-26');
    expect(targetWeekStart(base, TODAY, ongoing)).toBe('2026-10-19');
    expect(targetWeekStart(base, TODAY, past)).toBe('2026-10-19');
    expect(targetWeekStart({ ...base, weekStart: '2026-10-12' }, TODAY, past)).toBe('2026-10-19');
  });
});
