import AsyncStorage from '@react-native-async-storage/async-storage';

import { addDays } from '@/domain/dates';
import { makeProfile, makeWorkout } from '@/domain/__tests__/fixtures';
import type { PlanProposal, Profile, ProposalDraft, ProposalStatus, Workout } from '@/domain/types';
import type { WeatherForecast, WeatherHour } from '@/domain/weather';

import { runWeatherCheck, weatherCheckKey, type WeatherCheckRepo } from '../runWeatherCheck';
import {
  EMPTY_CHECK_STATE,
  afterCheck,
  coveredWorkoutIds,
  dueCheck,
  isWeatherOnlyProposal,
  mayPropose,
  staleWeatherProposals,
  weatherModel,
} from '../weatherChecks';
import { needsPlaceHint, placeRowSubtitle, sessionWeatherView } from '../weatherModel';

const MON = '2026-10-26';
const TUE = addDays(MON, 1);
const SUN = addDays(MON, 6);
const PLACE = { name: 'Valencia', lat: 39.47, lon: -0.38 };

function proposal(overrides: Partial<PlanProposal> = {}): PlanProposal {
  return {
    id: 'p1',
    userId: 'me',
    kind: 'replan',
    source: 'rules',
    weekStart: MON,
    summary: 'Sal a correr entre las 8 y las 17: no llueve.',
    changes: [{ op: 'move', workoutId: 'run', toDate: TUE, toStartTime: '15:30', reason: 'Lluvia' }],
    status: 'pending',
    model: weatherModel('day', 'w1-aaaa'),
    createdAt: new Date(2026, 9, 27, 8, 0).toISOString(),
    ...overrides,
  };
}

describe('dueCheck', () => {
  it('Monday: the weekly check (it covers today too)', () => {
    expect(dueCheck(MON, 7 * 60, EMPTY_CHECK_STATE)).toEqual({ scope: 'week', from: MON, monday: MON });
    expect(dueCheck(MON, 7 * 60, { ...EMPTY_CHECK_STATE, weeklyFor: MON, daily: MON })).toBeNull();
  });

  it('Sunday from 18:00 looks at the week that starts the next day; earlier, only today', () => {
    const nextMonday = addDays(SUN, 1);
    expect(dueCheck(SUN, 19 * 60, EMPTY_CHECK_STATE)).toEqual({ scope: 'week', from: nextMonday, monday: nextMonday });
    expect(dueCheck(SUN, 9 * 60, EMPTY_CHECK_STATE)).toEqual({ scope: 'day', from: SUN });
  });

  it('every other day: once, on the first open', () => {
    expect(dueCheck(TUE, 8 * 60, EMPTY_CHECK_STATE)).toEqual({ scope: 'day', from: TUE });
    expect(dueCheck(TUE, 20 * 60, { ...EMPTY_CHECK_STATE, daily: TUE })).toBeNull();
  });

  it('afterCheck: a Sunday-evening weekly check does not count as the daily one', () => {
    const next = afterCheck(EMPTY_CHECK_STATE, { scope: 'week', from: addDays(SUN, 1), monday: addDays(SUN, 1) }, SUN);
    expect(next).toEqual({ daily: null, weeklyFor: addDays(SUN, 1), expired: [] });
  });
});

describe('one weather proposal a day, never the same one twice', () => {
  const state = EMPTY_CHECK_STATE;

  it('none created today already', () => {
    expect(mayPropose([proposal()], 'w1-bbbb', TUE, state)).toBe(false);
    expect(mayPropose([proposal()], 'w1-bbbb', addDays(TUE, 1), state)).toBe(true);
  });

  it('a proposal the athlete discarded never comes back', () => {
    const refused = proposal({ status: 'discarded' });
    expect(mayPropose([refused], 'w1-aaaa', addDays(TUE, 3), state)).toBe(false);
  });

  it('…unless the app closed it itself because it went out of date', () => {
    const closed = proposal({ status: 'discarded' });
    expect(mayPropose([closed], 'w1-aaaa', addDays(TUE, 3), { ...state, expired: ['w1-aaaa'] })).toBe(true);
  });

  it('no signature, no proposal', () => {
    expect(mayPropose([], '', TUE, state)).toBe(false);
  });

  it('a pending daily proposal from yesterday is stale; a weekly one only after a week', () => {
    const daily = proposal();
    const weekly = proposal({ id: 'p2', model: weatherModel('week', 'w1-cccc') });
    expect(staleWeatherProposals([daily, weekly], addDays(TUE, 1)).map((p) => p.id)).toEqual(['p1']);
    expect(staleWeatherProposals([weekly], addDays(TUE, 7)).map((p) => p.id)).toEqual(['p2']);
    expect(staleWeatherProposals([proposal({ model: null })], addDays(TUE, 9))).toEqual([]);
  });

  it('sessions in a pending weather proposal are left out of new ones', () => {
    expect(coveredWorkoutIds([proposal(), proposal({ id: 'p3', status: 'applied', changes: [{ op: 'delete', workoutId: 'x', reason: '' }] })])).toEqual(['run']);
  });

  it('only weather replans are "El tiempo" banners (a planned week that took it into account is not)', () => {
    expect(isWeatherOnlyProposal(proposal())).toBe(true);
    expect(isWeatherOnlyProposal(proposal({ kind: 'generate_week', model: weatherModel('plan', 'w1-dddd') }))).toBe(false);
    expect(isWeatherOnlyProposal(proposal({ model: 'rules-v1' }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runWeatherCheck with an in-memory repository
// ---------------------------------------------------------------------------

function rainBetween(date: string, from: number, to: number): WeatherForecast {
  const hours: WeatherHour[] = [0, 1, 2].flatMap((offset) => {
    const day = addDays(date, offset);
    return Array.from({ length: 24 }, (_, hour) => {
      const wet = day === date && hour >= from && hour < to;
      return { date: day, hour, tempC: 13, windKmh: 9, precipMm: wet ? 1.5 : 0, precipProb: null, symbol: wet ? 'rain' : 'cloudy', coarse: false };
    });
  });
  return { place: 'Valencia', source: 'met_norway', updatedAt: `${date}T05:00:00Z`, hours };
}

function fakeRepo(workouts: Workout[], forecast: WeatherForecast | null, proposals: PlanProposal[] = []) {
  const created: ProposalDraft[] = [];
  const statuses: { id: string; status: ProposalStatus }[] = [];
  const repo: WeatherCheckRepo = {
    getWeather: async () => forecast,
    listWorkouts: async () => workouts,
    listBusyBlocks: async () => [],
    listLifeEvents: async () => [],
    listJointSessions: async () => [],
    listProposals: async () => proposals,
    createProposal: async (draft) => {
      created.push(draft);
      return proposal({ ...draft, id: `new-${created.length}`, model: draft.model ?? null });
    },
    setProposalStatus: async (id, status) => {
      statuses.push({ id, status });
    },
  };
  return { repo, created, statuses };
}

const athlete: Profile = makeProfile({
  weatherPlace: PLACE,
  availability: { mode: 'auto', weeklyHoursTarget: 9, restDay: null, longSessionDays: [5, 6], windows: [], poolDays: [] },
});
const tuesdayMorning = new Date(2026, 9, 27, 8, 0);
const eveningRun = makeWorkout({ id: 'run', date: TUE, startTime: '18:00', sport: 'run', title: 'Rodaje suave', durationMin: 50 });

describe('runWeatherCheck', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("morning: today's run in the rain → one proposal with the dry hours, never applied", async () => {
    const { repo, created } = fakeRepo([eveningRun], rainBetween(TUE, 17, 21));
    await expect(runWeatherCheck(repo, 'me', athlete, tuesdayMorning)).resolves.toBe('proposed');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ kind: 'replan', source: 'rules', weekStart: MON });
    expect(created[0]?.model).toMatch(/^weather:day:w1-/);
    expect(created[0]?.changes).toEqual([expect.objectContaining({ op: 'move', workoutId: 'run', toDate: TUE, toStartTime: '15:30' })]);
    expect(created[0]?.summary).toBe('Sal a correr entre las 8:15 y las 17: no llueve.');
  });

  it('runs once a day: the second open does nothing', async () => {
    const { repo, created } = fakeRepo([eveningRun], rainBetween(TUE, 17, 21));
    await runWeatherCheck(repo, 'me', athlete, tuesdayMorning);
    await expect(runWeatherCheck(repo, 'me', athlete, new Date(2026, 9, 27, 12, 0))).resolves.toBe('not_due');
    expect(created).toHaveLength(1);
  });

  it('never re-proposes what the athlete discarded', async () => {
    const first = fakeRepo([eveningRun], rainBetween(TUE, 17, 21));
    await runWeatherCheck(first.repo, 'me', athlete, tuesdayMorning);
    const signature = first.created[0]?.model ?? '';
    await AsyncStorage.clear();
    const refused = proposal({ status: 'discarded', model: signature, createdAt: new Date(2026, 9, 26, 8, 0).toISOString() });
    const again = fakeRepo([eveningRun], rainBetween(TUE, 17, 21), [refused]);
    await expect(runWeatherCheck(again.repo, 'me', athlete, tuesdayMorning)).resolves.toBe('blocked');
    expect(again.created).toHaveLength(0);
  });

  it('closes yesterday’s pending daily proposal (out of date)', async () => {
    const old = proposal({ id: 'old', createdAt: new Date(2026, 9, 26, 8, 0).toISOString() });
    const { repo, statuses } = fakeRepo([], rainBetween(TUE, 17, 21), [old]);
    await expect(runWeatherCheck(repo, 'me', athlete, tuesdayMorning)).resolves.toBe('nothing');
    expect(statuses).toEqual([{ id: 'old', status: 'discarded' }]);
    const saved = JSON.parse((await AsyncStorage.getItem(weatherCheckKey('me'))) ?? '{}') as { expired?: string[] };
    expect(saved.expired).toEqual(['w1-aaaa']);
  });

  it('without a city or a forecast it does nothing', async () => {
    const { repo, created } = fakeRepo([eveningRun], null);
    await expect(runWeatherCheck(repo, 'me', { ...athlete, weatherPlace: null }, tuesdayMorning)).resolves.toBe('not_due');
    await expect(runWeatherCheck(repo, 'me', athlete, tuesdayMorning)).resolves.toBe('no_forecast');
    expect(created).toHaveLength(0);
  });

  it('dry day: nothing to propose', async () => {
    const { repo, created } = fakeRepo([eveningRun], rainBetween(TUE, 0, 0));
    await expect(runWeatherCheck(repo, 'me', athlete, tuesdayMorning)).resolves.toBe('nothing');
    expect(created).toHaveLength(0);
  });
});

describe('weatherModel', () => {
  it('Tú row subtitle', () => {
    expect(placeRowSubtitle(PLACE)).toBe('Valencia · la lluvia cuenta al planificar');
    expect(placeRowSubtitle(null)).toBe('Para tener en cuenta la lluvia');
  });

  it('Plan hint: only without a city and with outdoor sessions still to do', () => {
    const week = [eveningRun];
    expect(needsPlaceHint(makeProfile(), week, MON)).toBe(true);
    expect(needsPlaceHint(athlete, week, MON)).toBe(false);
    expect(needsPlaceHint(makeProfile(), [{ ...eveningRun, sport: 'swim' }], MON)).toBe(false);
    expect(needsPlaceHint(makeProfile(), week, addDays(TUE, 1))).toBe(false);
  });

  it('session line: rain at its time with the dry gap; nothing indoors', () => {
    const view = sessionWeatherView(rainBetween(TUE, 17, 21), eveningRun, MON, tuesdayMorning);
    expect(view).toMatchObject({ rainy: true, source: 'met_norway', line: 'Lluvia a las 18. Sal a correr entre las 7 y las 17: no llueve.' });
    expect(sessionWeatherView(rainBetween(TUE, 17, 21), { ...eveningRun, sport: 'bike', title: 'Rodillo' }, MON, tuesdayMorning)).toBeNull();
    expect(sessionWeatherView(null, eveningRun, MON, tuesdayMorning)).toBeNull();
  });
});
