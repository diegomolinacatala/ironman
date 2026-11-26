import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import RacesScreen from '@/app/races/index';
import { addDays, todayISO } from '@/domain/dates';
import type { Race, Thresholds, Workout } from '@/domain/types';

import { RACE_PLAN_HIGHLIGHT_DAYS, nextARace, racePlanView, ridePoints } from '../racePlanModel';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), dismissTo: jest.fn(), navigate: jest.fn() };
let mockRaces: Race[] = [];
let mockThresholds: Thresholds = {};
let mockWorkouts: Workout[] = [];

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
}));
jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);
jest.mock('@/data/queries', () => ({
  useRaces: () => ({ data: mockRaces, isLoading: false, error: null, refetch: jest.fn(), isRefetching: false }),
  useProfile: () => ({ data: { thresholds: mockThresholds, level: 'intermediate' }, isLoading: false }),
  useWorkouts: () => ({ data: mockWorkouts, isLoading: false }),
}));

jest.setTimeout(30000);

const FULL: Thresholds = { ftpW: 250, runThresholdPaceSecPerKm: 270, swimCssSecPer100m: 105, lthr: 170, maxHr: 190 };

function race(id: string, daysAhead: number, patch: Partial<Race> = {}): Race {
  return {
    id,
    userId: 'me',
    name: `Carrera ${id}`,
    date: addDays(todayISO(), daysAhead),
    distance: 'half',
    priority: 'A',
    location: null,
    goal: null,
    notes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
}

function ride(id: string, daysAgo: number, completed: Workout['completed'], sport: Workout['sport'] = 'bike'): Workout {
  return {
    id,
    userId: 'me',
    date: addDays(todayISO(), -daysAgo),
    startTime: null,
    sport,
    title: 'Rodaje',
    description: null,
    durationMin: 90,
    distanceM: null,
    intensity: 'endurance',
    tss: null,
    steps: [],
    status: completed ? 'completed' : 'planned',
    completed,
    source: 'garmin',
    isKey: false,
    jointSessionId: null,
    externalId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRaces = [];
  mockThresholds = FULL;
  mockWorkouts = [];
});

describe('racePlanModel', () => {
  const today = '2026-11-26';

  test('picks the next A race, never a B race or a past one', () => {
    const races = [
      race('b', 5, { priority: 'B', date: '2026-12-01' }),
      race('late', 90, { date: '2027-02-24' }),
      race('past', -3, { date: '2026-11-23' }),
      race('soon', 30, { date: '2026-12-26' }),
    ];
    expect(nextARace(races, today)?.id).toBe('soon');
    expect(nextARace([race('b', 5, { priority: 'B' })], today)).toBeNull();
  });

  test('highlights the plan from three weeks before, with a countdown tag', () => {
    const at = (date: string) => racePlanView({ races: [race('a', 0, { date })], today, thresholds: FULL });
    expect(RACE_PLAN_HIGHLIGHT_DAYS).toBe(21);
    expect(at('2026-12-18')?.highlighted).toBe(false);
    expect(at('2026-12-17')).toMatchObject({ highlighted: true, badge: 'En 21 días', daysToRace: 21 });
    expect(at('2026-11-27')?.badge).toBe('Mañana');
    expect(at('2026-11-26')?.badge).toBe('Hoy');
  });

  test('no plan for a race of unknown legs', () => {
    expect(racePlanView({ races: [race('x', 40, { distance: 'other' })], today })).toBeNull();
  });

  test('carries the prediction and times the fueling with its leg minutes', () => {
    const view = racePlanView({ races: [race('a', 0, { date: '2027-03-01' })], today, thresholds: FULL });
    expect(view?.prediction?.ok).toBe(true);
    // Bike leg ≈ 164' (prediction) instead of the typical 170': 70 g/h → 191 g.
    expect(view?.plan.fuel.bike?.totalCarbsG).toBe(191);
  });

  test('turns completed rides with distance into prediction points', () => {
    const points = ridePoints([
      ride('r1', 3, { durationMin: 90, distanceM: 48_000, avgHr: 145 }),
      ride('r2', 5, { durationMin: 60, distanceM: 30_000 }),
      ride('r3', 6, { durationMin: 60 }),
      ride('p1', 2, null),
      ride('run', 4, { durationMin: 50, distanceM: 10_000, avgHr: 150 }, 'run'),
    ]);
    expect(points.map((p) => [p.durationMin, p.distanceM, p.avgHr])).toEqual([
      [90, 48_000, 145],
      [60, 30_000, null],
    ]);
  });
});

describe('Carreras → Plan de carrera', () => {
  test('far from the race: folded under the A race with a one-line summary', async () => {
    mockRaces = [race('a', 60), race('b', 20, { priority: 'B' })];
    await render(<RacesScreen />);
    const fold = screen.getByTestId('race-plan');
    expect(within(fold).getByText('Plan de carrera')).toBeTruthy();
    expect(within(fold).getByText('Bici 190–205 W · carrera 4:52–5:05 /km · 70 g/h')).toBeTruthy();
    expect(screen.queryByTestId('race-plan-bike')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: /Plan de carrera/ }));
    expect(screen.getByTestId('race-plan-bike')).toBeTruthy();
    expect(screen.getByText('190–205 W · 75–82 % FTP')).toBeTruthy();
  });

  test('three weeks out: highlighted, open, with the prediction first and every block', async () => {
    mockRaces = [race('a', 12)];
    await render(<RacesScreen />);
    expect(screen.getByText('En 12 días')).toBeTruthy();
    const prediction = screen.getByTestId('race-prediction');
    expect(within(prediction).getByText('Previsión: 5:01–5:29')).toBeTruthy();
    expect(within(prediction).getByText(/^Natación 35–38' · T1 3–6' · Bici 2:3\d–2:50 · T2 2–4' · Carrera 1:43–1:52$/)).toBeTruthy();
    expect(within(prediction).getByText('Supone recorrido llano, sin viento, y que sigues el plan.')).toBeTruthy();
    expect(screen.getByTestId('race-plan-swim')).toBeTruthy();
    expect(screen.getByTestId('race-plan-run')).toBeTruthy();
    expect(screen.getByText('1:47–1:49 /100 m')).toBeTruthy();
    expect(within(screen.getByTestId('race-plan-fuel')).getByText(/70 g\/h de hidratos/)).toBeTruthy();
    expect(within(screen.getByTestId('race-plan-transitions')).getByText('T1 · natación → bici')).toBeTruthy();
  });

  test('without thresholds: guidance by sensations and a link to add them', async () => {
    mockThresholds = {};
    mockRaces = [race('a', 10, { distance: 'olympic' })];
    await render(<RacesScreen />);
    const hint = screen.getByRole('button', { name: /Añade tu FTP, tu ritmo umbral, tu CSS y tu FC umbral o máxima/ });
    expect(screen.getAllByText('RPE 7–8').length).toBeGreaterThan(0);
    expect(
      within(screen.getByTestId('race-prediction')).getByText('Para ver tu previsión, añade tu FTP y tu ritmo umbral en Tú › Perfil.'),
    ).toBeTruthy();
    await fireEvent.press(hint);
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/profile');
  });

  test('without FTP, recent rides at race heart rate give the bike prediction', async () => {
    mockThresholds = { runThresholdPaceSecPerKm: 270, lthr: 170, swimCssSecPer100m: 105 };
    mockWorkouts = [
      ride('r1', 3, { durationMin: 90, distanceM: 48_000, avgHr: 145 }),
      ride('r2', 10, { durationMin: 120, distanceM: 62_000, avgHr: 148 }),
      ride('r3', 17, { durationMin: 60, distanceM: 30_000, avgHr: 142 }),
    ];
    mockRaces = [race('a', 12)];
    await render(<RacesScreen />);
    const prediction = screen.getByTestId('race-prediction');
    expect(within(prediction).getByText(/Bici 2:54–3:05/)).toBeTruthy();
    expect(within(prediction).getByText(/Bici según tus salidas recientes\./)).toBeTruthy();
  });

  test('a marathon as A race gets a run-only plan', async () => {
    mockRaces = [race('m', 15, { distance: 'run_marathon' })];
    await render(<RacesScreen />);
    expect(screen.getByText('Ritmo 4:46–5:02 /km · 50 g/h')).toBeTruthy();
    expect(screen.queryByTestId('race-plan-bike')).toBeNull();
    expect(screen.queryByTestId('race-plan-transitions')).toBeNull();
  });

  test('no A race: no plan', async () => {
    mockRaces = [race('b', 20, { priority: 'B' })];
    await render(<RacesScreen />);
    expect(screen.queryByTestId('race-plan')).toBeNull();
  });
});
