import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { resetDisclosureState } from '@/ui/disclosureState';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ActionSheetIOS } from 'react-native';

import WorkoutDetailScreen from '@/app/workout/[id]';
import { addDays, todayISO } from '@/domain/dates';
import type { Thresholds, Workout, WorkoutPatch, WorkoutStep } from '@/domain/types';
import type { CoachVerdictModel } from '@/features/workouts/coachAdapters';
import { HR_HINT_TEXT } from '@/features/workouts/detail/ThresholdsHint';
import { MYWHOOSH_STORAGE_KEY, resetMyWhooshForTests, setMyWhooshEnabled } from '@/features/workouts/myWhooshSetting';
import { completeKey, enqueueOffline, resetOfflineQueueForTests } from '@/data/offline/offlineQueue';
import { OFFLINE_NOTICE_TEXT } from '@/features/offline/OfflineNotice';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ME, makeWorkout } from './fixtures';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
const mockRedirect = jest.fn((_href: string) => null);
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
const mockVerdict = jest.fn((_w: Workout, _t: Thresholds | null, _r: unknown): CoachVerdictModel | null => null);
let mockAuth = { session: { userId: ME, email: null } as { userId: string; email: string | null } | null, isLoading: false };
let mockWorkout: { data: Workout | null | undefined; isLoading: boolean } = { data: undefined, isLoading: false };
let mockThresholds: Thresholds | null = null;
let mockHistory: Workout[] = [];

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  Redirect: ({ href }: { href: string }) => mockRedirect(href),
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'w1' }),
}));
jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);
jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: () => null,
  DateTimePickerAndroid: { open: jest.fn() },
}));
jest.mock('@/data/context', () => ({ useAuth: () => mockAuth }));
jest.mock('@/data/queries', () => ({
  useWorkout: () => ({ ...mockWorkout, error: null, refetch: jest.fn(), isRefetching: false }),
  useJointSession: () => ({ data: null, isLoading: false, error: null }),
  useProfile: () => ({ data: { thresholds: mockThresholds } }),
  useRaces: () => ({ data: [] }),
  useCompleteWorkout: () => ({ mutateAsync: jest.fn(), isPending: false, error: null }),
  useWorkouts: () => ({ data: mockHistory }),
}));
jest.mock('@/features/workouts/useWorkoutActions', () => ({ useWorkoutActions: () => mockActions }));
// The coach's rules (domain/planB, domain/review) are unit-tested on their own: the screen only wires them.
jest.mock('@/features/workouts/coachAdapters', () => ({
  easierPatch: (w: Workout, t: Thresholds | null) => mockEasierPatch(w, t),
  workoutVerdict: (w: Workout, t: Thresholds | null, r: unknown) => mockVerdict(w, t, r),
}));

jest.setTimeout(30000);

const STEPS: WorkoutStep[] = [
  { kind: 'warmup', durationMin: 15 },
  { kind: 'work', durationMin: 8, repeat: 3, intensity: 'threshold', cue: 'Fuerte pero controlado' },
  { kind: 'recovery', durationMin: 2, repeat: 3 },
  { kind: 'cooldown', durationMin: 10 },
];
const COACHING = {
  objective: 'Subir tu umbral sin pasarte',
  keys: ['Las tres series al mismo ritmo', 'Recupera trotando'],
  success: 'Terminas la última serie con una más en las piernas',
  planB: "Rodaje suave de 40'",
};
const EASIER: WorkoutPatch = { title: 'Rodaje suave', durationMin: 40, intensity: 'endurance', steps: [] };

function series(overrides: Partial<Workout> = {}): Workout {
  return makeWorkout({
    id: 'w1',
    date: todayISO(),
    title: 'Series 3×8',
    intensity: 'threshold',
    durationMin: 60,
    steps: STEPS,
    coaching: COACHING,
    ...overrides,
  });
}

async function openSection(name: string) {
  await fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
}

async function chooseOption(label: string) {
  const sheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((options, select) => {
    select(options.options.indexOf(label));
  });
  try {
    await openSection('Opciones');
  } finally {
    sheet.mockRestore();
  }
}

beforeEach(async () => {
  resetDisclosureState();
  resetMyWhooshForTests();
  await AsyncStorage.removeItem(MYWHOOSH_STORAGE_KEY);
  jest.clearAllMocks();
  mockRouter.canGoBack.mockReturnValue(true);
  mockAuth = { session: { userId: ME, email: null }, isLoading: false };
  mockWorkout = { data: undefined, isLoading: false };
  mockThresholds = { lthr: 170, runThresholdPaceSecPerKm: 270 };
  mockEasierPatch.mockReturnValue(null);
  mockVerdict.mockReturnValue(null);
});

describe('workout detail', () => {
  test('waits for the session instead of flashing "no encontrado" (cold-start widget link)', async () => {
    mockAuth = { session: null, isLoading: true };
    await render(<WorkoutDetailScreen />);
    expect(screen.queryByText('Entreno no encontrado')).toBeNull();
    expect(screen.getByLabelText('Cargando entreno')).toBeTruthy();
  });

  test('signed out sends the user through the entry gate', async () => {
    mockAuth = { session: null, isLoading: false };
    await render(<WorkoutDetailScreen />);
    expect(mockRedirect).toHaveBeenCalledWith('/');
  });

  test('not found with no back stack offers a way to Hoy', async () => {
    mockRouter.canGoBack.mockReturnValue(false);
    mockWorkout = { data: null, isLoading: false };
    await render(<WorkoutDetailScreen />);
    expect(screen.getByText('Entreno no encontrado')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Volver' }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/today');
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  test('deleting with no back stack lands on Hoy', async () => {
    mockRouter.canGoBack.mockReturnValue(false);
    mockWorkout = { data: makeWorkout({ id: 'w1' }), isLoading: false };
    await render(<WorkoutDetailScreen />);
    await chooseOption('Borrar');
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/today'));
    expect(mockActions.remove).toHaveBeenCalledTimes(1);
  });

  test('deleting goes back when there is a previous screen', async () => {
    mockWorkout = { data: makeWorkout({ id: 'w1' }), isLoading: false };
    await render(<WorkoutDetailScreen />);
    await chooseOption('Borrar');
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});

describe('workout detail · the coach’s prescription', () => {
  test('objective, keys, main target, one row per step, success and plan B', async () => {
    mockWorkout = { data: series(), isLoading: false };
    await render(<WorkoutDetailScreen />);
    expect(screen.getByRole('button', { name: 'Registrar entreno' })).toBeTruthy();
    expect(screen.queryByText('Carga')).toBeNull();
    expect(screen.queryByText('Recupera trotando')).toBeNull();
    await openSection('Guía del entreno');
    await openSection('Objetivos y zonas');
    expect(screen.getByText('Objetivo')).toBeTruthy();
    expect(screen.getAllByText('Subir tu umbral sin pasarte').length).toBeGreaterThan(0);
    expect(screen.getByText('Claves')).toBeTruthy();
    expect(screen.getByText('Recupera trotando')).toBeTruthy();
    expect(screen.getByLabelText("Zona objetivo: 162–168 ppm, 3×8' Z4 · 4:27–4:44 /km · RPE 7–8")).toBeTruthy();
    expect(screen.getByText('Carga')).toBeTruthy();
    expect(screen.queryByText(/TSS/)).toBeNull();
    expect(screen.getByText('Estructura')).toBeTruthy();
    expect(screen.getByLabelText("3×8' Series. Zona Z4. 162–168 ppm, 4:27–4:44 /km, RPE 7–8. Fuerte pero controlado.")).toBeTruthy();
    expect(screen.getByLabelText(/^15' Calentamiento\. Zona Z1\. 128–143 ppm/)).toBeTruthy();
    expect(screen.getByText('Si no es tu día')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^Si no es tu día/ }));
    expect(screen.getByText('Lo has hecho bien si…')).toBeTruthy();
    expect(screen.getByText('Terminas la última serie con una más en las piernas')).toBeTruthy();
    expect(screen.getByText("Rodaje suave de 40'")).toBeTruthy();
    expect(screen.queryByLabelText(HR_HINT_TEXT)).toBeNull();
  });

  test('"Hacer la versión suave" applies the easier version through the confirm flow', async () => {
    const workout = series();
    mockWorkout = { data: workout, isLoading: false };
    mockEasierPatch.mockReturnValue(EASIER);
    await render(<WorkoutDetailScreen />);
    expect(mockEasierPatch).toHaveBeenCalledWith(workout, mockThresholds);
    await fireEvent.press(screen.getByRole('button', { name: /^Si no es tu día/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Hacer la versión suave' }));
    expect(mockActions.easier).toHaveBeenCalledWith(workout, EASIER);
  });

  test('a missed session from a past day offers no plan B', async () => {
    mockEasierPatch.mockReturnValue(EASIER);
    mockWorkout = { data: series({ date: addDays(todayISO(), -2) }), isLoading: false };
    await render(<WorkoutDetailScreen />);
    expect(screen.queryByText('Si no es tu día')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hacer la versión suave' })).toBeNull();
    expect(mockEasierPatch).not.toHaveBeenCalled();
  });

  test('without heart-rate thresholds a discreet hint links to Tú › Perfil', async () => {
    mockThresholds = { runThresholdPaceSecPerKm: 270 };
    mockWorkout = { data: series(), isLoading: false };
    await render(<WorkoutDetailScreen />);
    await openSection('Objetivos y zonas');
    expect(screen.getByLabelText(/^Zona objetivo: 4:27–4:44 \/km/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: HR_HINT_TEXT }));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/profile');
  });

  test('a manual session without coaching still shows its target from the intensity', async () => {
    mockThresholds = { lthr: 170 };
    mockWorkout = { data: makeWorkout({ id: 'w1', intensity: 'endurance' }), isLoading: false };
    await render(<WorkoutDetailScreen />);
    await openSection('Guía del entreno');
    await openSection('Objetivos y zonas');
    expect(screen.getByLabelText(/^Zona objetivo: 145–151 ppm, Z2/)).toBeTruthy();
    expect(screen.getAllByText('Cómo debe sentirse').length).toBeGreaterThan(0);
    expect(screen.queryByText('Objetivo')).toBeNull();
    expect(screen.queryByText('Si no es tu día')).toBeNull();
  });

  test('with no thresholds at all the target is the effort (RPE)', async () => {
    mockThresholds = null;
    mockWorkout = { data: series({ coaching: undefined }), isLoading: false };
    await render(<WorkoutDetailScreen />);
    await openSection('Objetivos y zonas');
    expect(screen.getByLabelText("Esfuerzo objetivo: RPE 7–8, 3×8' Z4")).toBeTruthy();
  });
});

describe('workout detail · completed', () => {
  test('plan vs real, the data source and the coach verdict', async () => {
    mockThresholds = { lthr: 170 };
    const done = series({
      status: 'completed',
      externalId: 'coros:987',
      completed: { durationMin: 58, avgHr: 152, rpe: 7, feel: 4, source: 'claude', completedAt: '2026-10-25T10:00:00.000Z' },
    });
    mockWorkout = { data: done, isLoading: false };
    mockVerdict.mockReturnValue({
      title: 'Umbral bien llevado',
      detail: 'FC media dentro de lo previsto.',
      next: 'Mañana, rodaje suave para asimilarlo.',
    });
    await render(<WorkoutDetailScreen />);
    expect(screen.getByText('Desde COROS')).toBeTruthy();
    expect(screen.getByLabelText("Duración: 58', plan 1h")).toBeTruthy();
    expect(screen.getByLabelText('FC media: 152 ppm, plan 143–154 ppm')).toBeTruthy();
    expect(screen.getByLabelText('RPE: 7 · Duro, plan 7–8')).toBeTruthy();
    expect(screen.getByLabelText('Sensaciones: Bien')).toBeTruthy();
    expect(mockVerdict).toHaveBeenCalledWith(done, mockThresholds, null);
    expect(
      screen.getByLabelText('Tu coach. Umbral bien llevado. FC media dentro de lo previsto. Mañana, rodaje suave para asimilarlo.'),
    ).toBeTruthy();
    expect(screen.queryByText('Si no es tu día')).toBeNull();
    expect(screen.getByRole('button', { name: /^Lo has hecho bien si…/ })).toBeTruthy();
  });
});

describe('workout detail · «Hecho» saved without connection', () => {
  test('says it waits on the phone, only for this session', async () => {
    resetOfflineQueueForTests();
    await enqueueOffline(ME, { kind: 'complete', key: completeKey('w1'), workoutId: 'w1', data: { durationMin: 60 } });
    mockWorkout = { data: series({ status: 'completed', completed: { durationMin: 60 } }), isLoading: false };
    await render(<WorkoutDetailScreen />);
    expect(screen.getByText(OFFLINE_NOTICE_TEXT)).toBeTruthy();
    mockWorkout = { data: series({ id: 'other' }), isLoading: false };
    await render(<WorkoutDetailScreen />);
    expect(screen.queryByText(OFFLINE_NOTICE_TEXT)).toBeNull();
    resetOfflineQueueForTests();
  });
});

describe('workout detail · MyWhoosh on the indoor trainer', () => {
  const BIKE_STEPS: WorkoutStep[] = [
    { kind: 'warmup', durationMin: 12, intensity: 'recovery' },
    { kind: 'work', durationMin: 20, repeat: 2, intensity: 'threshold' },
    { kind: 'recovery', durationMin: 4, repeat: 2, intensity: 'recovery' },
    { kind: 'cooldown', durationMin: 1, intensity: 'recovery' },
  ];
  const LINE = "En rodillo: MyWhoosh › Threshold › Threshold 20 (2×20' al 95 %, 61')";

  function bikeSession(overrides: Partial<Workout> = {}): Workout {
    return series({ sport: 'bike', title: "Bici umbral 2×20'", durationMin: 61, steps: BIKE_STEPS, coaching: undefined, ...overrides });
  }

  test('off by default: no MyWhoosh line', async () => {
    mockWorkout = { data: bikeSession(), isLoading: false };
    await render(<WorkoutDetailScreen />);
    await openSection('Guía del entreno');
    expect(screen.getByText('Estructura')).toBeTruthy();
    expect(screen.queryByText(/^En rodillo/)).toBeNull();
  });

  test('turned on: one quiet line with the closest free workout', async () => {
    await setMyWhooshEnabled(true);
    mockWorkout = { data: bikeSession(), isLoading: false };
    await render(<WorkoutDetailScreen />);
    await openSection('Guía del entreno');
    expect(screen.getByText(LINE)).toBeTruthy();
    expect(screen.getByLabelText("En rodillo: MyWhoosh, carpeta Threshold, Threshold 20: 2×20' al 95 %, 61 minutos.")).toBeTruthy();
  });

  test('the setting stored on the device is read on open', async () => {
    await AsyncStorage.setItem(MYWHOOSH_STORAGE_KEY, '1');
    mockWorkout = { data: bikeSession(), isLoading: false };
    await render(<WorkoutDetailScreen />);
    await openSection('Guía del entreno');
    expect(await screen.findByText(LINE)).toBeTruthy();
  });

  test('only for planned bike sessions', async () => {
    await setMyWhooshEnabled(true);
    mockWorkout = { data: series(), isLoading: false };
    await render(<WorkoutDetailScreen />);
    expect(screen.queryByText(/^En rodillo/)).toBeNull();
    mockWorkout = { data: bikeSession({ status: 'completed', completed: { durationMin: 61 } }), isLoading: false };
    await render(<WorkoutDetailScreen />);
    expect(screen.queryByText(/^En rodillo/)).toBeNull();
  });
});

describe('workout detail · against similar sessions', () => {
  test('a completed run says how it compares with the similar ones', async () => {
    const easy = (id: string, date: string, km: number, hr: number): Workout =>
      series({ id, date, intensity: 'endurance', title: 'Rodaje', status: 'completed', completed: { durationMin: 55, distanceM: km * 1000, avgHr: hr } });
    mockHistory = [easy('h1', '2026-10-10', 9, 150), easy('h2', '2026-10-14', 9, 151), easy('h3', '2026-10-18', 9.2, 150)];
    mockWorkout = { data: easy('today', '2026-10-25', 10, 148), isLoading: false };
    await render(<WorkoutDetailScreen />);
    expect(screen.getByText(/^Eficiencia un \d+ % mejor que la media de tus 3 carreras parecidas/)).toBeTruthy();
    mockHistory = [];
  });
});