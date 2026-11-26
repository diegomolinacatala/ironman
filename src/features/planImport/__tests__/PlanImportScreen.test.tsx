import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import PlanImportScreen from '@/app/plan-import';
import type { ImportedPlan, PlanImport, PlanImportDraft, PlanImportResult, PlanParseInput } from '@/domain/planImport';
import { parsePlanText } from '@/domain/planImportText';
import type { PickedPlanFile } from '@/integrations/files/planFiles';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true), dismissTo: jest.fn() };
const mockNotify = jest.fn();
const mockImports: { value: PlanImport[] } = { value: [] };
const mockParse = jest.fn(async (input: PlanParseInput): Promise<ImportedPlan> => parsePlanText(input.kind === 'text' ? input.text : ''));
const mockApply = jest.fn(
  async (draft: PlanImportDraft): Promise<PlanImportResult> => ({
    import: {
      id: 'imp1',
      source: draft.source,
      title: draft.title,
      startDate: draft.workouts[0]!.date,
      endDate: draft.workouts[draft.workouts.length - 1]!.date,
      sessionCount: draft.workouts.length,
      confidence: draft.confidence,
      createdAt: '2026-11-26T10:00:00.000Z',
    },
    added: draft.workouts.length,
    replaced: 2,
  }),
);
const mockDelete = jest.fn(async (_id: string) => ({ removed: 3 }));
const mockConfirm = jest.fn(async () => true);
const mockPickFile = jest.fn(async (): Promise<PickedPlanFile | null> => null);
const mockFileText = jest.fn(async () => '');

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  Stack: { Screen: () => null },
}));
jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);
jest.mock('@/data/context', () => ({
  useAuth: () => ({ session: { userId: 'u1', email: null }, isLoading: false, auth: {}, mode: 'demo' }),
}));
jest.mock('@/data/queries', () => ({
  useParsePlanImport: () => ({ mutateAsync: mockParse, isPending: false }),
  useApplyPlanImport: () => ({ mutateAsync: mockApply, isPending: false }),
  usePlanImports: () => ({ data: mockImports.value, isLoading: false }),
  useDeletePlanImport: () => ({ mutateAsync: mockDelete, isPending: false }),
}));
jest.mock('@/features/workouts/confirm', () => ({
  notify: (...args: unknown[]) => mockNotify(...args),
  confirmAsync: () => mockConfirm(),
}));
jest.mock('@/integrations/files/planFiles', () => ({
  pickPlanFile: () => mockPickFile(),
  pickPlanPhoto: jest.fn(async () => null),
  readPlanFileText: () => mockFileText(),
  readPlanFileBytes: jest.fn(async () => new Uint8Array()),
  readPlanFileBase64: jest.fn(async () => ''),
  fetchCalendarFeed: jest.fn(async () => 'BEGIN:VCALENDAR\nEND:VCALENDAR'),
}));

jest.setTimeout(30000);

beforeEach(() => {
  jest.clearAllMocks();
  mockImports.value = [];
});

const PLAN = "Semana 1\nMartes: rodaje 45' Z2\nJueves: bici 1h30 con 3x10' Z4\nSemana 2\nMartes: natación 2000 m";

describe('Importar un plan', () => {
  test('pasted text → review by week → saved as imported sessions, then back to Plan', async () => {
    await render(<PlanImportScreen />);
    expect(screen.getByText('TrainingPeaks')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^Pegar el texto/ }));
    await fireEvent.changeText(screen.getByLabelText('Tu plan'), PLAN);
    await fireEvent.press(screen.getByRole('button', { name: 'Leer el plan' }));

    await waitFor(() => expect(mockParse).toHaveBeenCalledWith({ kind: 'text', text: PLAN }));
    expect(await screen.findByText('¿Cuándo empieza la semana 1?')).toBeTruthy();
    expect(screen.getByText(/^Semana 1 · /)).toBeTruthy();
    expect(screen.getByText(/^Semana 2 · /)).toBeTruthy();
    expect(screen.getByText('Rodaje 45\' Z2')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Nombre del plan'), 'Plan de Marta');
    await fireEvent.press(screen.getByRole('button', { name: 'Una semana después' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar en mi plan' }));

    await waitFor(() => expect(mockApply).toHaveBeenCalledTimes(1));
    const draft = mockApply.mock.calls[0]![0];
    expect(draft).toMatchObject({ source: 'text', title: 'Plan de Marta', replaceGenerated: true });
    expect(draft.workouts).toHaveLength(3);
    expect(draft.workouts.every((w) => w.source === 'imported')).toBe(true);
    await waitFor(() => expect(mockRouter.dismissTo).toHaveBeenCalledWith('/week'));
    expect(mockNotify).toHaveBeenCalledWith('Plan importado', expect.stringMatching(/3 sesiones añadidas.*2 sesiones/));
  });

  test('editing a session in the review and removing another', async () => {
    await render(<PlanImportScreen />);
    await fireEvent.press(screen.getByRole('button', { name: /^Pegar el texto/ }));
    await fireEvent.changeText(screen.getByLabelText('Tu plan'), PLAN);
    await fireEvent.press(screen.getByRole('button', { name: 'Leer el plan' }));
    await fireEvent.press(await screen.findByRole('button', { name: /^Rodaje 45' Z2/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Quitar sesión' }));
    expect(screen.queryByText("Rodaje 45' Z2")).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar en mi plan' }));
    await waitFor(() => expect(mockApply).toHaveBeenCalledTimes(1));
    expect(mockApply.mock.calls[0]![0].workouts).toHaveLength(2);
  });

  test('a CSV with unknown headers asks for the columns first', async () => {
    mockPickFile.mockResolvedValueOnce({ name: 'plan.csv', kind: 'csv', size: 100, uri: 'file:///plan.csv', webFile: null });
    mockFileText.mockResolvedValueOnce('Cuándo;Qué\nLunes;Rodaje 40 min Z2\nMiércoles;Bici 1h');
    await render(<PlanImportScreen />);
    await fireEvent.press(screen.getByRole('button', { name: /^Excel o CSV/ }));
    expect(await screen.findByText(/No reconozco todas las columnas/)).toBeTruthy();
    const continueButton = screen.getByRole('button', { name: 'Continuar' });
    expect(continueButton.props.accessibilityState).toMatchObject({ disabled: true });
    const dayChips = screen.getAllByRole('button', { name: 'Día de la semana' });
    await fireEvent.press(dayChips[0]!);
    const descriptionChips = screen.getAllByRole('button', { name: 'Descripción' });
    await fireEvent.press(descriptionChips[1]!);
    await fireEvent.press(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByText('¿Cuándo empieza la semana 1?')).toBeTruthy();
    expect(screen.getByDisplayValue('plan')).toBeTruthy();
  });

  test('TrainingPeaks explains Premium and the rolling window; Garmin explains why not', async () => {
    await render(<PlanImportScreen />);
    await fireEvent.press(screen.getByRole('button', { name: /^TrainingPeaks/ }));
    expect(screen.getByText(/solo da este enlace a las cuentas Premium/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Elegir otra fuente' }));
    await fireEvent.press(screen.getByRole('button', { name: /^Garmin Connect/ }));
    expect(screen.getByText('Garmin no deja leer su calendario')).toBeTruthy();
  });

  test('saved imports can be removed', async () => {
    mockImports.value = [
      { id: 'imp9', source: 'pdf', title: 'Bloque base', startDate: '2026-11-30', endDate: '2026-12-27', sessionCount: 20, confidence: 'high', createdAt: '2026-11-20T10:00:00.000Z' },
    ];
    await render(<PlanImportScreen />);
    expect(screen.getByText('Bloque base')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Quitar Bloque base' }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('imp9'));
    expect(mockNotify).toHaveBeenCalledWith('Plan quitado', '3 sesiones pendientes borradas.');
  });
});
