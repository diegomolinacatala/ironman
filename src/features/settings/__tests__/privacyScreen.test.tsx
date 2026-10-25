import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';

import PrivacyScreen from '@/app/privacy';
import type { Profile } from '@/domain/types';

import { AI_CONSENT_TITLE } from '../AiConsentCard';
import { CALENDAR_PRIVACY_NOTE, PRIVACY_SUMMARY, openPrivacyPolicy, resolvePolicyUrl } from '../privacyPolicy';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
const mockState: { mode: 'demo' | 'supabase'; consentAt: string | null } = { mode: 'supabase', consentAt: null };
const mockUpdateProfile = jest.fn(async (patch: Partial<Profile>) => patch);

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
});

describe('Privacidad', () => {
  test('summarises the policy and turns the Coach IA consent on', async () => {
    await render(<PrivacyScreen />);
    for (const section of PRIVACY_SUMMARY) expect(screen.getByText(section.title)).toBeTruthy();
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

describe('privacy policy link', () => {
  test('only https URLs are used', () => {
    expect(resolvePolicyUrl(' https://rebufo.app/privacidad ')).toBe('https://rebufo.app/privacidad');
    expect(resolvePolicyUrl('http://rebufo.app/privacidad')).toBeNull();
    expect(resolvePolicyUrl('javascript:alert(1)')).toBeNull();
    expect(resolvePolicyUrl(undefined)).toBeNull();
  });

  test('opens the policy in the in-app browser', async () => {
    expect(await openPrivacyPolicy('https://rebufo.app/privacidad')).toBe(true);
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://rebufo.app/privacidad');
    expect(await openPrivacyPolicy(null)).toBe(false);
  });

  test('calendar copy says friends and the Coach IA never get event titles', () => {
    expect(CALENDAR_PRIVACY_NOTE).toContain('tus amigos solo ven ‘ocupado’');
    expect(CALENDAR_PRIVACY_NOTE).toContain('el Coach IA solo recibe las horas ocupadas, nunca los títulos');
    expect(CALENDAR_PRIVACY_NOTE).not.toContain('nunca salen de tu cuenta');
  });
});
