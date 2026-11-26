import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ActionSheetIOS } from 'react-native';

import TodayScreen from '@/app/(tabs)/today';
import { completeKey, enqueueOffline, removeOfflineKey, resetOfflineQueueForTests } from '@/data/offline/offlineQueue';
import { listenFlushRequests } from '@/data/offline/useOfflineSync';
import { OFFLINE_NOTICE_TEXT } from '@/features/offline/OfflineNotice';
import type { JointSession, NutritionLog, Thresholds, Workout, WorkoutPatch, WorkoutStep } from '@/domain/types';
import type { WeatherForecast, WeatherHour } from '@/domain/weather';
import { ME, makeSession, makeWorkout } from '@/features/workouts/__tests__/fixtures';

import { resetDisclosureState } from '@/ui/disclosureState';

import type { TodayData } from '../useTodayData';

/** The folded sections of Hoy (Informe, Mañana, Comidas…). */
async function openFold(title: RegExp): Promise<void> {
  await fireEvent.press(screen.getByRole('button', { name: title }));
}

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
const mockActions = {
  moveTo: jest.fn(async (_w: Workout, _date: string) => true),
  moveToTomorrow: jest.fn(async (_w: Workout) => true),
  duplicate: jest.fn(async (_w: Workout) => null),
  remove: jest.fn(async (_w: Workout) => true),
  skip: jest.fn(async (_w: Workout) => true),
  reset: jest.fn(async (_w: Workout) => true),
  invite: jest.fn((_w: Workout) => undefined),
  easier: jest.fn(async (_w: Workout, _patch: WorkoutPatch) => true),
  busy: false,
};
const mockEasierPatch = jest.fn((_w: Workout, _t: Thresholds | null): WorkoutPatch | null => null);
let mockData: TodayData;
let mockCalendarEnabled = false;
let mockInlineAccessory = false;
let mockForecast: WeatherForecast | null = null;

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useLocalSearchParams: () => ({}),
}));
jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('../useTodayData', () => ({ useTodayData: () => mockData }));
jest.mock('@/features/workouts/useWorkoutActions', () => ({ useWorkoutActions: () => mockActions }));
// domain/planB is unit-tested on its own: Hoy only offers its patch.
jest.mock('@/features/workouts/coachAdapters', () => ({
  easierPatch: (w: Workout, t: Thresholds | null) => mockEasierPatch(w, t),
}));
jest.mock('@/features/briefing/BriefingCard', () => ({ BriefingCard: () => null }));
jest.mock('@/integrations/calendar/trainingCalendar', () => ({
  useTrainingCalendar: () => ({ enabled: mockCalendarEnabled, syncedWorkoutIds: ['h'] }),
}));
jest.mock('@/integrations/camera/mealPhoto', () => ({ mealPhotoUri: () => null }));
jest.mock('@/data/queries', () => ({
  useCompleteWorkout: () => ({ mutateAsync: jest.fn(), isPending: false, error: null }),
  useBriefing: () => ({ data: null }),
  useWeather: () => ({ data: mockForecast }),
}));
jest.mock('@/features/today/TodaySocialCard', () => ({ TodaySocialCard: () => null, todayQuedadas: () => [] }));
// Its own hook reads the week and the watch: tested on its own (adaptNudge).
jest.mock('@/features/today/AdaptNudgeCard', () => ({ AdaptNudgeCard: () => null }));
jest.mock('@/features/accessory/CoachAccessory', () => ({ CoachAccessory: () => null }));
jest.mock('@/features/accessory/coachActions', () => ({
  ...(jest.requireActual('@/features/accessory/coachActions') as object),
  needsInlineAccessory: () => mockInlineAccessory,
}));

function meal(overrides: Partial<NutritionLog> = {}): NutritionLog {
  return {
    id: 'n1',
    userId: ME,
    date: '2026-10-25',
    meal: 'lunch',
    description: 'Pasta con atún',
    kcal: 640,
    carbsG: 90,
    proteinG: 32,
    fatG: 14,
    createdAt: '2026-10-25T13:00:00.000Z',
    ...overrides,
  };
}

function data(overrides: Partial<TodayData> = {}): TodayData {
  return {
    today: '2026-10-25',
    tomorrow: '2026-10-26',
    myId: ME,
    displayName: 'Diego Molina',
    thresholds: null,
    raceDistance: null,
    todayWorkouts: [],
    tomorrowWorkouts: [],
    jointSessions: [],
    invites: [],
    proposals: [],
    race: null,
    racesReady: true,
    phase: null,
    meals: [],
    checkinDone: false,
    unread: 0,
    isLoading: false,
    error: null,
    isRefreshing: false,
    refresh: async () => undefined,
    ...overrides,
  };
}

// First render pulls in the whole screen tree (cold transform on CI/Windows).
jest.setTimeout(30000);

beforeEach(() => {
  jest.clearAllMocks();
  resetDisclosureState();
  mockCalendarEnabled = false;
  mockInlineAccessory = false;
  mockForecast = null;
  mockEasierPatch.mockReturnValue(null);
});

const SERIES_STEPS: WorkoutStep[] = [
  { kind: 'warmup', durationMin: 15 },
  { kind: 'work', durationMin: 8, repeat: 3, intensity: 'threshold', cue: 'Fuerte pero controlado' },
  { kind: 'recovery', durationMin: 2, repeat: 3 },
  { kind: 'cooldown', durationMin: 10 },
];

function coachedSeries(): Workout {
  return makeWorkout({
    id: 'h',
    title: 'Series 3×8',
    intensity: 'threshold',
    durationMin: 60,
    steps: SERIES_STEPS,
    coaching: { objective: 'Subir tu umbral sin pasarte', keys: [], success: 'Series iguales', planB: null },
  });
}

/** A whole day of the same weather on 2026-10-25 (MET hourly steps). */
function dayForecast(rain: boolean, source: WeatherForecast['source'] = 'met_norway'): WeatherForecast {
  const hours: WeatherHour[] = Array.from({ length: 24 }, (_, hour) => ({
    date: '2026-10-25',
    hour,
    tempC: 14,
    windKmh: 10,
    precipMm: rain ? 2 : 0,
    precipProb: rain ? 90 : 0,
    symbol: rain ? 'rain' : 'clearsky_day',
    coarse: false,
  }));
  return { place: 'Valencia', source, updatedAt: '2026-10-25T05:00:00Z', hours };
}

describe('Hoy · the weather of the outdoor session', () => {
  test('rain at the session time shows one line on the card with the MET credit', async () => {
    mockForecast = dayForecast(true);
    mockData = data({ todayWorkouts: [makeWorkout({ id: 'h', startTime: '18:00', durationMin: 60 })] });
    await render(<TodayScreen />);
    expect(screen.getByText('Lluvia a las 18 y ningún hueco seco hoy: mejor rodillo o piscina.')).toBeTruthy();
    expect(screen.getByText('Datos del tiempo: MET Norway')).toBeTruthy();
  });

  test('a dry forecast stays off the card (it lives in the session detail)', async () => {
    mockForecast = dayForecast(false);
    mockData = data({ todayWorkouts: [makeWorkout({ id: 'h', startTime: '18:00', durationMin: 60 })] });
    await render(<TodayScreen />);
    expect(screen.queryByText(/Sin lluvia prevista|Lluvia/)).toBeNull();
  });

  test('indoor sessions and athletes without a forecast see nothing about the weather', async () => {
    mockForecast = dayForecast(true);
    mockData = data({ todayWorkouts: [makeWorkout({ id: 'h', sport: 'bike', title: 'Rodillo MyWhoosh', startTime: '18:00', durationMin: 60 })] });
    await render(<TodayScreen />);
    expect(screen.queryByText(/Lluvia/)).toBeNull();
    mockForecast = null;
    mockData = data({ todayWorkouts: [makeWorkout({ id: 'h', startTime: '18:00', durationMin: 60 })] });
    await render(<TodayScreen />);
    expect(screen.queryByText(/Lluvia|MET Norway/)).toBeNull();
  });

  test('wind: a strong one proposes the trainer in the line, a breeze is only a warning, a calm day says nothing', async () => {
    const ride = () => makeWorkout({ id: 'h', sport: 'bike', title: 'Rodaje en bici', startTime: '18:00', durationMin: 60 });
    const windy = (kmh: number): WeatherForecast => {
      const fc = dayForecast(false);
      return { ...fc, hours: fc.hours.map((h) => ({ ...h, windKmh: kmh })) };
    };
    mockForecast = windy(40);
    mockData = data({ todayWorkouts: [ride()] });
    await render(<TodayScreen />);
    expect(screen.getByText('Viento fuerte (40 km/h) a las 18 y ningún rato más tranquilo hoy: mejor rodillo.')).toBeTruthy();
    mockForecast = windy(28);
    await render(<TodayScreen />);
    expect(screen.getByText('Viento (28 km/h) a las 18 · 14 °C')).toBeTruthy();
    mockForecast = windy(12);
    await render(<TodayScreen />);
    expect(screen.queryByText(/Viento|viento/)).toBeNull();
  });
});

describe('Hoy · the session card', () => {
  test('summary only: objective, targets and structure live behind "Ver entreno"', async () => {
    mockData = data({ todayWorkouts: [coachedSeries()], thresholds: { lthr: 170, runThresholdPaceSecPerKm: 270 } });
    await render(<TodayScreen />);
    expect(screen.getByText('Tu próxima sesión')).toBeTruthy();
    expect(screen.queryByText('Subir tu umbral sin pasarte')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Ver entreno' }));
    expect(mockRouter.push).toHaveBeenCalledWith(`/workout/${coachedSeries().id}`);
  });

  test('"No es mi día" in the options applies the easier version', async () => {
    const hero = coachedSeries();
    const patch: WorkoutPatch = { title: 'Rodaje suave', durationMin: 40, intensity: 'endurance', steps: [] };
    mockEasierPatch.mockReturnValue(patch);
    const sheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((options, callback) => {
      callback((options.options as string[]).indexOf('No es mi día'));
    });
    mockData = data({ todayWorkouts: [hero], thresholds: { lthr: 170 } });
    await render(<TodayScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Opciones del entreno' }));
    expect(sheet.mock.calls[0]?.[0].options).toEqual(['Registrar como hecho', 'No es mi día', 'Mover a otro día', 'Saltar', 'Cancelar']);
    expect(mockEasierPatch).toHaveBeenCalledWith(hero, { lthr: 170 });
    expect(mockActions.easier).toHaveBeenCalledWith(hero, patch);
    sheet.mockRestore();
  });

  test('no easier version: register as done, move or skip', async () => {
    const sheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => undefined);
    mockData = data({ todayWorkouts: [coachedSeries()] });
    await render(<TodayScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Opciones del entreno' }));
    expect(sheet.mock.calls[0]?.[0].options).toEqual(['Registrar como hecho', 'Mover a otro día', 'Saltar', 'Cancelar']);
    sheet.mockRestore();
  });
});

describe('Hoy · saved without connection', () => {
  test('a calm notice while a «Hecho» waits on the phone; «Reintentar» asks to send it now', async () => {
    resetOfflineQueueForTests();
    mockData = data({ todayWorkouts: [coachedSeries()] });
    await render(<TodayScreen />);
    expect(screen.queryByText(OFFLINE_NOTICE_TEXT)).toBeNull();
    await act(async () => {
      await enqueueOffline(ME, { kind: 'complete', key: completeKey('h'), workoutId: 'h', data: { durationMin: 60 } });
    });
    expect(screen.getByText(OFFLINE_NOTICE_TEXT)).toBeTruthy();
    const flush = jest.fn();
    const stop = listenFlushRequests(flush);
    await fireEvent.press(screen.getByRole('button', { name: 'Reintentar' }));
    expect(flush).toHaveBeenCalledTimes(1);
    stop();
    await act(async () => {
      await removeOfflineKey(ME, completeKey('h'));
    });
    expect(screen.queryByText(OFFLINE_NOTICE_TEXT)).toBeNull();
  });
});

describe('Hoy', () => {
  test('secondary sections start folded with a one-line summary', async () => {
    mockData = data({ tomorrowWorkouts: [makeWorkout({ id: 't', title: 'Bici Z2', durationMin: 90 })] });
    await render(<TodayScreen />);
    expect(screen.getByRole('button', { name: /^Informe de hoy/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Mañana · .*Bici Z2 · 1h 30'/ })).toBeTruthy();
    expect(screen.queryByText('Bici Z2')).toBeNull();
    await openFold(/^Mañana/);
    expect(screen.getByText('Bici Z2')).toBeTruthy();
  });

  test('greets by first name and shows the date line', async () => {
    mockData = data();
    await render(<TodayScreen />);
    expect(screen.getByText(/^(Buenos días|Buenas tardes|Buenas noches), Diego$/)).toBeTruthy();
    expect(screen.getByText('Domingo 25 de octubre')).toBeTruthy();
  });

  test("today's session with time, calendar badge, partner and bell", async () => {
    mockCalendarEnabled = true;
    const hero: Workout = makeWorkout({
      id: 'h',
      title: 'Rodaje Z2',
      startTime: '18:30',
      jointSessionId: 's1',
      steps: [{ kind: 'warmup', durationMin: 10 }],
    });
    const session: JointSession = makeSession({ status: 'confirmed' });
    mockData = data({ todayWorkouts: [hero], jointSessions: [session], unread: 3 });
    await render(<TodayScreen />);
    expect(screen.getByText('Rodaje Z2')).toBeTruthy();
    expect(screen.getByText('En tu calendario')).toBeTruthy();
    expect(screen.getByText('Con Álex')).toBeTruthy();
    expect(screen.getByLabelText('Avisos, 3 sin leer')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Ver entreno' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/workout/h');
  });

  test('a day with no sessions is a free day; a planned rest is a rest day', async () => {
    mockData = data();
    await render(<TodayScreen />);
    expect(screen.getByText('Hoy tienes el día libre')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Añadir entreno' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/workout/edit?date=2026-10-25');
    mockData = data({ todayWorkouts: [makeWorkout({ id: 'r', sport: 'rest', title: 'Descanso', durationMin: 0, intensity: 'recovery' })] });
    await screen.rerender(<TodayScreen />);
    expect(screen.getByText('Hoy toca descanso')).toBeTruthy();
  });

  test('meals: tiles, totals and the + Foto shortcut', async () => {
    mockData = data({ meals: [meal({ id: 'a', meal: 'breakfast', kcal: 1200 }), meal({ id: 'b' })] });
    await render(<TodayScreen />);
    expect(screen.getByText('1.840 kcal · 2 comidas')).toBeTruthy();
    await openFold(/^Comidas de hoy/);
    expect(screen.getByText('Hoy llevas 1.840 kcal · 180 g HC · 64 g proteína')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^Desayuno: Pasta con atún/ }));
    expect(mockRouter.push).toHaveBeenCalledWith('/nutrition?date=2026-10-25');
    await fireEvent.press(screen.getByRole('button', { name: 'Añadir una comida con una foto' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/meal?source=camera');
  });

  test('pending invites and proposals become banners', async () => {
    mockData = data({
      invites: [makeSession()],
      proposals: [
        {
          id: 'p1',
          userId: ME,
          kind: 'replan',
          source: 'claude',
          weekStart: '2026-10-19',
          summary: 'Menos intensidad tras el pádel',
          changes: [],
          status: 'pending',
          model: null,
          createdAt: '2026-10-25T07:00:00.000Z',
        },
      ],
    });
    await render(<TodayScreen />);
    await fireEvent.press(screen.getByText('Tirada larga'));
    expect(mockRouter.push).toHaveBeenCalledWith('/joint/s1');
    await fireEvent.press(screen.getByText('Menos intensidad tras el pádel'));
    expect(mockRouter.push).toHaveBeenCalledWith('/proposal/p1');
  });

  test('shows an error with retry', async () => {
    const refresh = jest.fn(async () => undefined);
    mockData = data({ error: new Error('Sin conexión'), refresh });
    await render(<TodayScreen />);
    expect(screen.getByText('Sin conexión')).toBeTruthy();
    await fireEvent.press(screen.getByText('Reintentar'));
    expect(refresh).toHaveBeenCalled();
  });

  test('quick actions: coach, sensaciones and imprevisto', async () => {
    mockData = data();
    await render(<TodayScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Hablar con mi coach' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/talk');
    await fireEvent.press(screen.getByRole('button', { name: 'Registrar mis sensaciones de hoy' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/checkin');
    await fireEvent.press(screen.getByRole('button', { name: 'Apuntar un imprevisto' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/event/edit');
  });

  test("today's check-in already saved still opens it to review", async () => {
    mockData = data({ checkinDone: true });
    await render(<TodayScreen />);
    expect(screen.queryByRole('button', { name: 'Registrar mis sensaciones de hoy' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Revisar mis sensaciones de hoy' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/checkin');
  });

  test('race countdown under the date opens the races list', async () => {
    mockData = data({
      race: {
        id: 'r1',
        userId: ME,
        name: 'Triatlón de Valencia',
        date: '2026-11-04',
        distance: 'half',
        priority: 'A',
        location: null,
        goal: null,
        notes: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
    await render(<TodayScreen />);
    await fireEvent.press(screen.getByRole('link', { name: 'Faltan 10 días para Triatlón de Valencia' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/races');
  });
});
