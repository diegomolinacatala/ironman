import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Briefing, IntegrationStatus } from '@/domain/types';

import { BriefingCard } from '../BriefingCard';
import { BRIEFING } from './fixtures';

interface QueryState {
  data: Briefing | null | undefined;
  isLoading: boolean;
  isFetched: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
}
interface IntegrationsState {
  data: IntegrationStatus[] | undefined;
  isLoading: boolean;
  isFetched: boolean;
  error: unknown;
  refetch: () => Promise<unknown>;
}

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
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
let mockBriefing: QueryState;
let mockIntegrations: IntegrationsState;
let mockSession: { userId: string } | null = { userId: 'user-me' };

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
}));
jest.mock('@/integrations/speech/useSpeaker', () => ({ useSpeaker: () => mockSpeaker }));
jest.mock('@/data/context', () => ({ useAuth: () => ({ session: mockSession, isLoading: false }) }));
jest.mock('@/data/queries', () => ({
  useBriefing: () => mockBriefing,
  useIntegrations: () => mockIntegrations,
  useGenerateBriefing: () => mockGenerate,
}));

const DATE = '2026-10-27';
const connected: IntegrationStatus[] = [
  { provider: 'garmin_personal', state: 'connected', expiresAt: null, lastSyncAt: null, lastError: null },
];

jest.setTimeout(30000);

beforeEach(() => {
  jest.clearAllMocks();
  mockSpeaker.speaking = false;
  mockSpeaker.paused = false;
  mockSpeaker.progress = 0;
  mockGenerate.isPending = false;
  mockGenerate.error = null;
  mockSession = { userId: 'user-me' };
  mockBriefing = { data: null, isLoading: false, isFetched: true, error: null, refetch: jest.fn(async () => undefined) };
  mockIntegrations = { data: connected, isLoading: false, isFetched: true, error: null, refetch: jest.fn(async () => undefined) };
});

describe('BriefingCard', () => {
  test('skeleton while loading', async () => {
    mockBriefing = { ...mockBriefing, data: undefined, isLoading: true, isFetched: false };
    await render(<BriefingCard date={DATE} />);
    expect(screen.getByLabelText('Cargando tu informe')).toBeTruthy();
  });

  test('cold start: no Garmin prompt before the session and first fetches settle', async () => {
    // Queries are disabled until signed in: not loading, not fetched, no data.
    mockSession = null;
    mockBriefing = { ...mockBriefing, data: undefined, isFetched: false };
    mockIntegrations = { ...mockIntegrations, data: undefined, isFetched: false };
    await render(<BriefingCard date={DATE} />);
    expect(screen.getByLabelText('Cargando tu informe')).toBeTruthy();
    expect(screen.queryByText('Conecta tu Garmin')).toBeNull();
  });

  test('asks to connect Garmin, or to prepare it without Garmin', async () => {
    mockIntegrations = { ...mockIntegrations, data: [] };
    await render(<BriefingCard date={DATE} />);
    expect(screen.getByText('Conecta tu Garmin')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Conectar Garmin' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/integrations');
    await fireEvent.press(screen.getByRole('button', { name: 'Prepararlo sin Garmin' }));
    expect(screen.getByText('Prepara tu informe')).toBeTruthy();
  });

  test('expired Garmin key asks to renew it', async () => {
    mockIntegrations = { ...mockIntegrations, data: [{ ...connected[0]!, state: 'expired' }] };
    await render(<BriefingCard date={DATE} />);
    expect(screen.getByText('Renueva tu Garmin')).toBeTruthy();
  });

  test('prepares the briefing on demand', async () => {
    await render(<BriefingCard date={DATE} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Preparar mi informe' }));
    expect(mockGenerate.mutateAsync).toHaveBeenCalledWith({ date: DATE, refresh: false });
  });

  test('friendly progress while generating', async () => {
    mockGenerate.isPending = true;
    await render(<BriefingCard date={DATE} />);
    expect(screen.getByText('Leyendo tu Garmin…')).toBeTruthy();
  });

  test('error with retry', async () => {
    mockGenerate.error = new Error('Sin conexión');
    await render(<BriefingCard date={DATE} />);
    expect(screen.getByText('Sin conexión')).toBeTruthy();
    await fireEvent.press(screen.getByText('Reintentar'));
    expect(mockGenerate.mutateAsync).toHaveBeenCalled();
  });

  test('ready: headline, last night and listen controls', async () => {
    mockBriefing = { ...mockBriefing, data: BRIEFING };
    await render(<BriefingCard date={DATE} />);
    expect(screen.getByText(BRIEFING.headline)).toBeTruthy();
    expect(screen.getByLabelText('Sueño: 7 horas y 20 minutos')).toBeTruthy();
    expect(screen.getByText('Por encima de tu media')).toBeTruthy();
    expect(screen.queryByText('Informe automático')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Escuchar · 1 min' }));
    expect(mockSpeaker.speak).toHaveBeenCalledWith(BRIEFING.script);
    await fireEvent.press(screen.getByRole('button', { name: 'Ver informe' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/briefing');
  });

  test('pause while reading; rules engine note', async () => {
    mockBriefing = { ...mockBriefing, data: { ...BRIEFING, engine: 'rules' } };
    mockSpeaker.speaking = true;
    mockSpeaker.progress = 0.4;
    await render(<BriefingCard date={DATE} />);
    expect(screen.getByText('Informe automático')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Pausa' }));
    expect(mockSpeaker.pause).toHaveBeenCalled();
  });
});
