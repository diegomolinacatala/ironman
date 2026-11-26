import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { addDays, startOfWeek, todayISO } from '@/domain/dates';
import type { Profile, Race } from '@/domain/types';
import { makeProfile, makeRace } from '@/features/workouts/__tests__/fixtures';

import { ONBOARDING_STEPS } from '../onboardingModel';
import { PlanStep } from '../steps/PlanStep';
import type { PlanGeneration } from '../usePlanGeneration';

let mockGeneration: PlanGeneration;
let mockProfile: Profile = makeProfile();
let mockRaces: Race[] = [];

jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);
jest.mock('../usePlanGeneration', () => ({ usePlanGeneration: () => mockGeneration }));
jest.mock('@/data/queries', () => {
  const ok = <T,>(data: T) => ({ data, isLoading: false, error: null, refetch: jest.fn(async () => undefined) });
  return { useProfile: () => ok(mockProfile), useRaces: () => ok(mockRaces) };
});

jest.setTimeout(30000);

const PLAN_STEP = ONBOARDING_STEPS.find((s) => s.id === 'plan') ?? ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1]!;
const NAV = { step: PLAN_STEP, index: ONBOARDING_STEPS.length - 1, total: ONBOARDING_STEPS.length, next: jest.fn() };
const monday = startOfWeek(todayISO());
const onFinish = jest.fn(async () => undefined);

function generation(overrides: Partial<PlanGeneration> = {}): PlanGeneration {
  return { phase: 'done', summary: ['4 sesiones en los próximos días · 4 h 30 min en total'], error: null, retry: jest.fn(), ...overrides };
}

async function renderStep() {
  await render(<PlanStep nav={NAV} plannedWeeks={[]} onWeekPlanned={jest.fn()} onFinish={onFinish} />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGeneration = generation();
  mockProfile = makeProfile();
  mockRaces = [];
});

describe('PlanStep', () => {
  test('while the plan is prepared it shows the work in progress, without the weeks', async () => {
    mockGeneration = generation({ phase: 'working', summary: [] });
    await renderStep();
    expect(screen.getByText('Organizando tus sesiones…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ver las próximas semanas' })).toBeNull();
  });

  test('if the plan fails it offers to retry or to start without a plan', async () => {
    const retry = jest.fn();
    mockGeneration = generation({ phase: 'error', summary: [], error: 'Sin conexión.', retry });
    await renderStep();
    expect(screen.getByText(/^Sin conexión\. Reinténtalo/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
    expect(retry).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Empezar sin plan' }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  test('once ready the next 4 weeks to the race are folded under "Ver las próximas semanas"', async () => {
    mockRaces = [makeRace({ name: 'Valencia', date: addDays(monday, 7 * 12 + 6) })];
    await renderStep();
    expect(screen.getByText('Tu plan está listo')).toBeTruthy();
    expect(screen.queryByText('Así llegarás a tu carrera')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Ver las próximas semanas' }));
    expect(screen.getByText('Así llegarás a tu carrera')).toBeTruthy();
    expect(screen.getByText(/^Hasta Valencia: /)).toBeTruthy();
    expect(screen.getByTestId('preview-week-current')).toBeTruthy();
    expect(screen.getAllByLabelText(/^(Esta semana|Semana del .+): .+, \d+ hora/)).toHaveLength(4);
    await fireEvent.press(screen.getByRole('button', { name: 'Ir a Hoy' }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  test('without a race the folded preview shows the next weeks', async () => {
    await renderStep();
    await fireEvent.press(screen.getByRole('button', { name: 'Ver las próximas semanas' }));
    expect(screen.getByText('Tus próximas semanas')).toBeTruthy();
    expect(screen.getByText(/^Sin carrera a la vista\. Próximas 8 semanas: /)).toBeTruthy();
  });

  test('no preview with manual availability and no weekly hours to plan from', async () => {
    mockProfile = makeProfile({ availability: { ...makeProfile().availability, mode: 'manual', weeklyHoursTarget: 0 } });
    await renderStep();
    expect(screen.getByText('Tu plan está listo')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ver las próximas semanas' })).toBeNull();
  });
});
