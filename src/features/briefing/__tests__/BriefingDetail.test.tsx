import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { Briefing, DailyMetrics, IntegrationStatus } from '@/domain/types';

import { BriefingDetail } from '../BriefingDetail';
import { BRIEFING } from './fixtures';

const mockSpeaker = {
  speaking: false,
  paused: false,
  progress: 0,
  voiceName: null as string | null,
  hasEnhancedVoice: true,
  speak: jest.fn((_text: string) => undefined),
  pause: jest.fn(),
  resume: jest.fn(),
  stop: jest.fn(),
};
const mockGenerate = {
  mutateAsync: jest.fn(async (_args: { date: string; refresh?: boolean }) => BRIEFING),
  isPending: false,
  error: null as unknown,
};
let mockBriefingData: Briefing | null | undefined = null;
let mockMetrics: Partial<DailyMetrics>[] = [];
let mockSession: { userId: string } | null = { userId: 'user-me' };
/** False = cold start: queries disabled until the session is restored. */
let mockFetched = true;
const connected: IntegrationStatus[] = [
  { provider: 'garmin_personal', state: 'connected', expiresAt: null, lastSyncAt: null, lastError: null },
];

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);
jest.mock('@/integrations/speech/useSpeaker', () => ({ useSpeaker: () => mockSpeaker }));
jest.mock('@/data/context', () => ({ useAuth: () => ({ session: mockSession, isLoading: false }) }));
jest.mock('@/data/queries', () => ({
  useBriefing: () => ({
    data: mockFetched ? mockBriefingData : undefined,
    isLoading: false,
    isFetched: mockFetched,
    error: null,
    refetch: async () => undefined,
  }),
  useIntegrations: () => ({
    data: mockFetched ? connected : undefined,
    isLoading: false,
    isFetched: mockFetched,
    error: null,
    refetch: async () => undefined,
  }),
  useGenerateBriefing: () => mockGenerate,
  useMetrics: () => ({ data: mockMetrics }),
  useWorkouts: () => ({ data: mockFetched ? [] : undefined, isLoading: false, isFetched: mockFetched, error: null }),
}));

const DATE = '2026-10-27';

jest.setTimeout(30000);

beforeEach(() => {
  jest.clearAllMocks();
  mockBriefingData = null;
  mockMetrics = [];
  mockSession = { userId: 'user-me' };
  mockFetched = true;
  mockGenerate.isPending = false;
});

describe('/briefing', () => {
  test('cold start: waits for the session and first fetches before generating or showing a rest day', async () => {
    mockSession = null;
    mockFetched = false;
    const view = await render(<BriefingDetail date={DATE} autoplay />);
    expect(mockGenerate.mutateAsync).not.toHaveBeenCalled();
    expect(screen.queryByText('Hoy toca descanso. Recargar también es entrenar.')).toBeNull();

    // Session restored, queries fetched: the stored briefing exists → no generation, it plays.
    mockSession = { userId: 'user-me' };
    mockFetched = true;
    mockBriefingData = BRIEFING;
    await view.rerender(<BriefingDetail date={DATE} autoplay />);
    await waitFor(() => expect(mockSpeaker.speak).toHaveBeenCalledWith(BRIEFING.script));
    expect(mockGenerate.mutateAsync).not.toHaveBeenCalled();
  });

  test('cold start without a stored briefing generates exactly once after settling', async () => {
    mockSession = null;
    mockFetched = false;
    const view = await render(<BriefingDetail date={DATE} autoplay={false} />);
    expect(mockGenerate.mutateAsync).not.toHaveBeenCalled();
    mockSession = { userId: 'user-me' };
    mockFetched = true;
    await view.rerender(<BriefingDetail date={DATE} autoplay={false} />);
    await waitFor(() => expect(mockGenerate.mutateAsync).toHaveBeenCalledTimes(1));
  });

  test('prepares a missing briefing as soon as it opens', async () => {
    await render(<BriefingDetail date={DATE} autoplay={false} />);
    await waitFor(() => expect(mockGenerate.mutateAsync).toHaveBeenCalledWith({ date: DATE, refresh: false }));
    expect(mockGenerate.mutateAsync).toHaveBeenCalledTimes(1);
  });

  test('play=1 reads the briefing aloud once and stops when closed', async () => {
    mockBriefingData = BRIEFING;
    const view = await render(<BriefingDetail date={DATE} autoplay />);
    await waitFor(() => expect(mockSpeaker.speak).toHaveBeenCalledWith(BRIEFING.script));
    expect(mockGenerate.mutateAsync).not.toHaveBeenCalled();
    await view.unmount();
    expect(mockSpeaker.stop).toHaveBeenCalled();
  });

  test('sleep card, plan, focus, script and Garmin attribution', async () => {
    mockBriefingData = BRIEFING;
    mockMetrics = [{ date: DATE, source: 'garmin' }];
    await render(<BriefingDetail date={DATE} autoplay={false} />);
    expect(screen.getByText(BRIEFING.headline)).toBeTruthy();
    expect(screen.getByLabelText('Puntuación de sueño: 82 de 100')).toBeTruthy();
    expect(screen.getByText('8 % por encima de tu media de 7 noches (48 ms)')).toBeTruthy();
    expect(screen.getByText('Hoy toca descanso. Recargar también es entrenar.')).toBeTruthy();
    expect(screen.getByText(BRIEFING.focus)).toBeTruthy();
    expect(screen.getByText('Datos de Garmin')).toBeTruthy();
    expect(screen.queryByText(BRIEFING.script)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Leer el informe' }));
    expect(screen.getByText(BRIEFING.script)).toBeTruthy();
  });

  test('player bar plays and refresh regenerates', async () => {
    mockBriefingData = BRIEFING;
    await render(<BriefingDetail date={DATE} autoplay={false} />);
    expect(mockSpeaker.speak).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Escuchar el informe' }));
    expect(mockSpeaker.speak).toHaveBeenCalledWith(BRIEFING.script);
    await fireEvent.press(screen.getByRole('button', { name: 'Actualizar informe' }));
    expect(mockGenerate.mutateAsync).toHaveBeenCalledWith({ date: DATE, refresh: true });
  });
});
