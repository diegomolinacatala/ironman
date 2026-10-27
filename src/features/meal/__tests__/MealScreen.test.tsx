import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Linking } from 'react-native';

import MealScreen from '@/app/meal';
import type { MealAnalysis, MealAnalysisInput, NutritionDraft, NutritionLog } from '@/domain/types';
import type { MealPhoto, MealPhotoSource } from '@/integrations/camera/mealPhoto';
import type { VoiceInput } from '@/integrations/speech/useVoiceInput';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
const mockParams: { value: Record<string, string> } = { value: {} };
const mockPhoto: MealPhoto = { uri: 'file:///meal.jpg', base64: 'QUJD', width: 1024, height: 768 };
const mockPick = jest.fn(async (_source: MealPhotoSource): Promise<MealPhoto | null> => mockPhoto);
const mockSavePhoto = jest.fn(async (_id: string, _photo: MealPhoto): Promise<string | null> => 'file:///meals/n1.jpg');
const mockAnalyze = jest.fn(
  async (_input: MealAnalysisInput): Promise<MealAnalysis> => ({
    meal: 'lunch',
    description: 'Pasta con atún',
    items: ['Pasta cocida · 250 g', 'Atún · 80 g'],
    kcal: 640,
    carbsG: 95,
    proteinG: 38,
    fatG: 14,
    confidence: 'medium',
    tip: 'Buena recarga para el rodaje de esta tarde.',
    engine: 'ai',
  }),
);
const mockCreate = jest.fn(
  async (draft: NutritionDraft): Promise<NutritionLog> => ({
    id: 'n1',
    userId: 'me',
    date: draft.date,
    meal: draft.meal,
    description: draft.description,
    kcal: draft.kcal ?? null,
    carbsG: draft.carbsG ?? null,
    proteinG: draft.proteinG ?? null,
    fatG: draft.fatG ?? null,
    createdAt: '2026-10-27T12:00:00.000Z',
  }),
);
const mockVoice: VoiceInput = {
  state: 'idle',
  transcript: '',
  level: 0,
  error: null,
  available: false,
  start: jest.fn(async () => undefined),
  stop: jest.fn(),
  cancel: jest.fn(),
  reset: jest.fn(),
};

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useLocalSearchParams: () => mockParams.value,
  Stack: { Screen: () => null },
}));
jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);
jest.mock('@/features/talk/motion', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    FadeIn: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    PulseRing: () => null,
    Shimmer: () => <View />,
  };
});
jest.mock('@/data/queries', () => ({
  useAnalyzeMeal: () => ({ mutateAsync: mockAnalyze, isPending: false }),
  useCreateNutrition: () => ({ mutateAsync: mockCreate, isPending: false }),
}));
jest.mock('@/integrations/camera/mealPhoto', () => ({
  pickMealPhoto: (source: MealPhotoSource) => mockPick(source),
  saveMealPhoto: (id: string, photo: MealPhoto) => mockSavePhoto(id, photo),
}));
jest.mock('@/integrations/speech/useVoiceInput', () => ({ useVoiceInput: () => ({ ...mockVoice }) }));

beforeEach(() => {
  jest.clearAllMocks();
  mockParams.value = {};
  Object.assign(mockVoice, { state: 'idle', transcript: '', error: null, available: false });
});

describe('Meal — photo', () => {
  test('opens the camera, analyses the photo and saves the edited result with its photo', async () => {
    mockParams.value = { source: 'camera' };
    await render(<MealScreen />);
    await waitFor(() => expect(mockAnalyze).toHaveBeenCalledTimes(1));
    expect(mockPick).toHaveBeenCalledWith('camera');
    expect(mockAnalyze.mock.calls[0]?.[0]).toMatchObject({ imageBase64: 'QUJD', time: expect.stringMatching(/^\d{2}:\d{2}$/) });

    expect((await screen.findByLabelText('Descripción')).props.value).toBe('Pasta con atún');
    expect(screen.getByLabelText('Foto de tu comida')).toBeTruthy();
    expect(screen.getByText('· Atún · 80 g')).toBeTruthy();
    expect(screen.getByText('Buena recarga para el rodaje de esta tarde.')).toBeTruthy();
    expect(screen.getByLabelText('Kcal en kilocalorías').props.value).toBe('640');
    expect(screen.getByRole('button', { name: 'Comida' }).props.accessibilityState).toMatchObject({ selected: true });

    await fireEvent.press(screen.getByRole('button', { name: 'Sumar 50 kcal de Kcal' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Cena' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[0]?.[0]).toMatchObject({ meal: 'dinner', description: 'Pasta con atún', kcal: 690, carbsG: 95, proteinG: 38, fatG: 14 });
    expect(mockSavePhoto).toHaveBeenCalledWith('n1', mockPhoto);
  });

  test('a cancelled camera shows the chooser', async () => {
    mockParams.value = { source: 'camera' };
    mockPick.mockResolvedValueOnce(null);
    await render(<MealScreen />);
    expect(await screen.findByText('¿Qué has comido?')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Fotos/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Descríbela/ })).toBeTruthy();
    expect(mockAnalyze).not.toHaveBeenCalled();
  });

  test('a permission error explains and offers Ajustes', async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    mockParams.value = { source: 'camera' };
    mockPick.mockRejectedValueOnce(new Error('Sin acceso a la cámara. Actívalo en Ajustes.'));
    await render(<MealScreen />);
    expect(await screen.findByText('Sin acceso a la cámara. Actívalo en Ajustes.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Abrir Ajustes' }));
    expect(openSettings).toHaveBeenCalled();
  });

  test('low confidence and the rules engine are flagged', async () => {
    mockParams.value = { source: 'library' };
    mockAnalyze.mockResolvedValueOnce({
      meal: 'snack',
      description: 'Algo de picar',
      items: [],
      kcal: null,
      carbsG: null,
      proteinG: null,
      fatG: null,
      confidence: 'low',
      tip: null,
      engine: 'rules',
    });
    await render(<MealScreen />);
    expect(await screen.findByText(/Estimación aproximada/)).toBeTruthy();
    expect(screen.getByText('Estimación automática (sin IA)')).toBeTruthy();
    expect(mockPick).toHaveBeenCalledWith('library');
  });
});

describe('Meal — description and manual entry', () => {
  test('a described meal is analysed as text; a failed analysis opens the manual form', async () => {
    mockParams.value = { source: 'text' };
    mockAnalyze.mockRejectedValueOnce(new Error('ai_unavailable'));
    await render(<MealScreen />);
    expect(screen.getByRole('button', { name: 'Analizar' })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Tu comida'), 'Lentejas con chorizo');
    await fireEvent.press(screen.getByRole('button', { name: 'Analizar' }));

    expect(await screen.findByText(/No he podido analizarla/)).toBeTruthy();
    expect(mockAnalyze.mock.calls[0]?.[0]).toMatchObject({ text: 'Lentejas con chorizo' });
    expect(mockAnalyze.mock.calls[0]?.[0]).not.toHaveProperty('imageBase64');
    expect(screen.getByLabelText('Descripción').props.value).toBe('Lentejas con chorizo');

    await fireEvent.changeText(screen.getByLabelText('Proteína en gramos'), '30');
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[0]?.[0]).toMatchObject({ description: 'Lentejas con chorizo', proteinG: 30, kcal: null });
    expect(mockSavePhoto).not.toHaveBeenCalled();
  });

  test('the dictate button ignores taps while a take is starting or stopping', async () => {
    mockParams.value = { source: 'text' };
    Object.assign(mockVoice, { available: true, state: 'requesting' });
    const view = await render(<MealScreen />);
    expect(screen.getByRole('button', { name: 'Dictar la comida' })).toBeDisabled();
    await view.unmount();

    Object.assign(mockVoice, { state: 'idle' });
    await render(<MealScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Dictar la comida' }));
    expect(mockVoice.start).toHaveBeenCalledTimes(1);
  });

  test('saving an empty description shows the validation error instead of closing', async () => {
    mockParams.value = { source: 'text' };
    await render(<MealScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Apuntar sin analizar' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Describe lo que has comido.')).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockRouter.back).not.toHaveBeenCalled();
  });
});
