/**
 * Modal routes of Juntos: a visible close control (VoiceOver / Switch Control
 * cannot swipe a sheet down) and submit errors next to the pinned button.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import AddFriendScreen from '@/app/friends/add';
import JointNewScreen from '@/app/joint/new';
import { AuthContext, RepositoryContext } from '@/data/context';
import type { Repository } from '@/data/repository';
import { addDays, todayISO } from '@/domain/dates';
import type { JointSessionDraft } from '@/domain/types';

import { makeProfile } from '@/features/workouts/__tests__/fixtures';

import { ME, friend, jointSession, workout } from './fixtures';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), setParams: jest.fn(), canGoBack: jest.fn(() => true) };
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useLocalSearchParams: () => mockParams,
  // Render the header-left control so the test can find and press it.
  Stack: { Screen: ({ options }: { options?: { headerLeft?: () => unknown } }) => options?.headerLeft?.() ?? null },
}));
jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);

jest.setTimeout(30000);

const tomorrow = addDays(todayISO(), 1);

function makeRepo() {
  return {
    mode: 'demo',
    auth: {},
    getMyProfile: jest.fn(async () => makeProfile({ id: ME })),
    listFriends: jest.fn(async () => [
      friend(),
      friend({ friendshipId: 'fs-marta' }, { id: 'u-marta', username: 'marta', displayName: 'Marta' }),
    ]),
    listWorkouts: jest.fn(async () => [workout({ id: 'w1', date: tomorrow })]),
    listBusyBlocks: jest.fn(async () => []),
    getFriendWeek: jest.fn(async () => []),
    proposeJointSession: jest.fn(async (_draft: JointSessionDraft) => jointSession({ id: 'j-new' })),
    searchProfiles: jest.fn(async () => []),
    subscribe: jest.fn(() => () => undefined),
  };
}

let repo = makeRepo();

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
  return (
    <RepositoryContext.Provider value={repo as unknown as Repository}>
      <AuthContext.Provider value={{ session: { userId: ME, email: null }, isLoading: false }}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </AuthContext.Provider>
    </RepositoryContext.Provider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRouter.canGoBack.mockReturnValue(true);
  repo = makeRepo();
  mockParams = {};
});

describe('joint/new', () => {
  test('inviting from a workout with two friends shows the missing-invitee error above the button', async () => {
    mockParams = { fromWorkoutId: 'w1', date: tomorrow, sport: 'run', durationMin: '60' };
    await render(<JointNewScreen />, { wrapper: Providers });
    await fireEvent.press(await screen.findByRole('button', { name: 'Enviar invitación' }));
    expect(within(screen.getByTestId('form-footer')).getByText('Elige al menos un amigo para invitar.')).toBeTruthy();
    expect(repo.proposeJointSession).not.toHaveBeenCalled();
  });

  test('picking a friend clears the error', async () => {
    await render(<JointNewScreen />, { wrapper: Providers });
    await fireEvent.press(await screen.findByRole('button', { name: 'Enviar invitación' }));
    expect(screen.getByText('Elige al menos un amigo para invitar.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Marta' }));
    expect(screen.queryByText('Elige al menos un amigo para invitar.')).toBeNull();
  });

  test('has a Cancelar header control', async () => {
    await render(<JointNewScreen />, { wrapper: Providers });
    await fireEvent.press(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });
});

describe('friends/add', () => {
  test('has a Cerrar header control that falls back to Hoy without a back stack', async () => {
    mockRouter.canGoBack.mockReturnValue(false);
    await render(<AddFriendScreen />, { wrapper: Providers });
    await fireEvent.press(screen.getByRole('button', { name: 'Cerrar' }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/today');
  });
});
