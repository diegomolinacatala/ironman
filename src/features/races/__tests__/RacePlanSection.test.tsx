import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import RacesScreen from '@/app/races/index';
import { addDays, todayISO } from '@/domain/dates';
import type { Race, Thresholds } from '@/domain/types';

import { RACE_PLAN_HIGHLIGHT_DAYS, nextARace, racePlanView } from '../racePlanModel';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), dismissTo: jest.fn(), navigate: jest.fn() };
let mockRaces: Race[] = [];
let mockThresholds: Thresholds = {};

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

beforeEach(() => {
  jest.clearAllMocks();
  mockRaces = [];
  mockThresholds = FULL;
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

  test('three weeks out: highlighted, open, with every block', async () => {
    mockRaces = [race('a', 12)];
    await render(<RacesScreen />);
    expect(screen.getByText('En 12 días')).toBeTruthy();
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
    await fireEvent.press(hint);
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/profile');
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
