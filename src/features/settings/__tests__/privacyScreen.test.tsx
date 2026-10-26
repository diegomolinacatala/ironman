import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';

import PrivacyScreen from '@/app/privacy';
import type { Profile } from '@/domain/types';

import { AI_CONSENT_TITLE } from '../AiConsentCard';
import { calendarPrivacyNote, openPrivacyPolicy, privacySummary, resolvePolicyUrl } from '../privacyPolicy';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
const mockState: { mode: 'demo' | 'supabase'; consentAt: string | null } = { mode: 'supabase', consentAt: null };
const mockUpdateProfile = jest.fn(async (patch: Partial<Profile>) => patch);
/** EXPO_PUBLIC_AI_COACH: the consent tests run with the in-app AI coach switched on. */
const mockEnvFlags = { aiCoachEnabled: true };

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
}));
jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'opened' })) }));
jest.mock('@/lib/env', () => {
  const actual = jest.requireActual<typeof import('@/lib/env')>('@/lib/env');
  // A lazy getter (not a spread, which would read it at import time) so each test can flip the flag.
  return Object.defineProperty({ ...actual }, 'env', {
    enumerable: true,
    get: () => ({ ...actual.env, aiCoachEnabled: mockEnvFlags.aiCoachEnabled }),
  });
});
jest.mock('@/data/context', () => ({
  useAuth: () => ({ session: { userId: 'u1', email: null }, isLoading: false, auth: {}, mode: mockState.mode }),
}));
jest.mock('@/data/queries', () => ({
  useProfile: () => ({ data: { aiConsentAt: mockState.consentAt }, isLoading: false, isError: false }),
  useUpdateProfile: () => ({ mutateAsync: mockUpdateProfile, isPending: false }),
}));

jest.setTimeout(30000);

beforeEach(() => {
  jest.clearAllMocks();
  mockState.mode = 'supabase';
  mockState.consentAt = null;
  mockEnvFlags.aiCoachEnabled = true;
});

describe('Privacidad', () => {
  test('summarises the policy and turns the Coach IA consent on', async () => {
    await render(<PrivacyScreen />);
    for (const section of privacySummary(true)) expect(screen.getByText(section.title)).toBeTruthy();
    expect(screen.getByText('Anthropic (Coach IA)')).toBeTruthy();
    const toggle = screen.getByRole('switch', { name: AI_CONSENT_TITLE });
    expect(toggle.props.value).toBe(false);
    await fireEvent(toggle, 'valueChange', true);
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledWith({ aiConsentAt: expect.any(String) }));
  });

  test('withdrawing the consent clears aiConsentAt', async () => {
    mockState.consentAt = '2026-10-20T10:00:00.000Z';
    await render(<PrivacyScreen />);
    expect(screen.getByText(/Activado desde el 20 oct 2026/)).toBeTruthy();
    await fireEvent(screen.getByRole('switch', { name: AI_CONSENT_TITLE }), 'valueChange', false);
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledWith({ aiConsentAt: null }));
  });

  test('the demo explains that nothing is sent to Anthropic', async () => {
    mockState.mode = 'demo';
    await render(<PrivacyScreen />);
    expect(screen.getByText(/En modo demo el coach usa el motor de reglas/)).toBeTruthy();
    expect(screen.queryByRole('switch', { name: AI_CONSENT_TITLE })).toBeNull();
  });

  test('without EXPO_PUBLIC_PRIVACY_URL there is no broken link', async () => {
    await render(<PrivacyScreen />);
    expect(screen.queryByRole('button', { name: 'Ver política completa' })).toBeNull();
    expect(screen.getByText(/La política completa se publicará/)).toBeTruthy();
  });
});

describe('Privacidad with the AI coach switched off (default)', () => {
  beforeEach(() => {
    mockEnvFlags.aiCoachEnabled = false;
  });

  test('hides the Coach IA section and only names Anthropic for your own Claude', async () => {
    await render(<PrivacyScreen />);
    for (const section of privacySummary(false)) expect(screen.getByText(section.title)).toBeTruthy();
    expect(screen.queryByText('Coach IA')).toBeNull();
    expect(screen.queryByText('Anthropic (Coach IA)')).toBeNull();
    expect(screen.queryByRole('switch', { name: AI_CONSENT_TITLE })).toBeNull();
    expect(screen.getByText('Tu propio Claude')).toBeTruthy();
    expect(screen.getAllByText(/Anthropic/)).toHaveLength(1);
  });

  test('the summary drops the Coach IA point', () => {
    const titles = privacySummary(false).flatMap((section) => section.points.map((point) => point.title));
    expect(titles).not.toContain('Anthropic (Coach IA)');
    expect(titles).toContain('Tu propio Claude');
    expect(privacySummary(true).flatMap((section) => section.points.map((point) => point.title))).toContain(
      'Anthropic (Coach IA)',
    );
  });
});

describe('privacy policy link', () => {
  test('only https URLs are used', () => {
    expect(resolvePolicyUrl(' https://roadtoironman.app/privacidad ')).toBe('https://roadtoironman.app/privacidad');
    expect(resolvePolicyUrl('http://roadtoironman.app/privacidad')).toBeNull();
    expect(resolvePolicyUrl('javascript:alert(1)')).toBeNull();
    expect(resolvePolicyUrl(undefined)).toBeNull();
  });

  test('opens the policy in the in-app browser', async () => {
    expect(await openPrivacyPolicy('https://roadtoironman.app/privacidad')).toBe(true);
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://roadtoironman.app/privacidad');
    expect(await openPrivacyPolicy(null)).toBe(false);
  });

  test('calendar copy says friends and the Coach IA never get event titles', () => {
    const note = calendarPrivacyNote(true);
    expect(note).toContain('tus amigos solo ven ‘ocupado’');
    expect(note).toContain('el Coach IA solo recibe las horas ocupadas, nunca los títulos');
    expect(note).not.toContain('nunca salen de tu cuenta');
  });

  test('with the AI coach off the calendar copy does not mention it', () => {
    const note = calendarPrivacyNote(false);
    expect(note).toContain('tus amigos solo ven ‘ocupado’');
    expect(note).toContain('tu plan solo usa las horas ocupadas, nunca los títulos');
    expect(note).not.toMatch(/Coach IA|Anthropic/);
  });
});
