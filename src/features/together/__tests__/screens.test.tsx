/**
 * Smoke tests for the Juntos screens against an in-memory fake repository.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import TogetherScreen from '@/app/(tabs)/together';
import FriendWeekScreen from '@/app/friends/[id]';
import AddFriendScreen from '@/app/friends/add';
import JointSessionScreen from '@/app/joint/[id]';
import JointNewScreen from '@/app/joint/new';
import NotificationsScreen from '@/app/notifications';
import { AuthContext, RepositoryContext } from '@/data/context';
import type { Repository } from '@/data/repository';
import { addDays, todayISO } from '@/domain/dates';
import type { JointSession, JointSessionDraft, Profile } from '@/domain/types';
import * as confirm from '@/features/social/confirm';

import { ALEX, feedItem, friend, friendItem, jointSession, ME, notification, participant, workout } from './fixtures';

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  setParams: jest.fn(),
  dismissTo: jest.fn(),
  navigate: jest.fn(),
  canGoBack: jest.fn(() => true),
};
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useLocalSearchParams: () => mockParams,
  // Render the header button so its actions (e.g. "Opciones de amistad") can be pressed.
  Stack: {
    Screen: ({ options }: { options?: { headerRight?: () => unknown } }) =>
      typeof options?.headerRight === 'function' ? options.headerRight() : null,
  },
}));

jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);

const today = todayISO();
const tomorrow = addDays(today, 1);

const profile = {
  id: ME,
  username: 'diego',
  displayName: 'Diego',
  avatarUrl: null,
  sports: ['run'],
  level: 'intermediate',
  thresholds: {},
  availability: { weeklyHoursTarget: 8, restDay: null, longSessionDays: [5, 6], windows: [], poolDays: [] },
  visibility: 'full',
  notificationPrefs: {
    workoutReminders: true,
    reminderMinutesBefore: 30,
    morningSummary: true,
    morningTime: '07:30',
    eveningCheckin: true,
    eveningTime: '21:30',
    weeklyPlanReminder: true,
    social: true,
  },
  timezone: 'Europe/Madrid',
  coachNotes: null,
  onboardedAt: '2026-10-01T10:00:00Z',
  aiConsentAt: null,
  createdAt: '2026-10-01T10:00:00Z',
} satisfies Profile;

const invite = jointSession({ id: 'j-invite', date: tomorrow });

function makeRepo() {
  const proposed: JointSession = jointSession({
    id: 'j-new',
    organizerId: ME,
    date: tomorrow,
    participants: [participant({ userId: ME }), participant({ userId: ALEX, displayName: 'Álex', status: 'invited' })],
  });
  return {
    mode: 'demo',
    auth: {},
    getMyProfile: jest.fn(async () => profile),
    listFriends: jest.fn(async () => [
      friend(),
      friend({ friendshipId: 'fs-marta', status: 'pending', direction: 'incoming' }, { id: 'u-marta', username: 'marta', displayName: 'Marta' }),
    ]),
    listFeed: jest.fn(async () => [feedItem()]),
    toggleKudos: jest.fn(async () => undefined),
    listNotifications: jest.fn(async () => [notification({ data: { url: '/joint/j-invite' }, createdAt: new Date().toISOString() })]),
    markNotificationsRead: jest.fn(async (_ids: string[] | 'all') => undefined),
    listJointSessions: jest.fn(async () => [invite]),
    getJointSession: jest.fn(async () => invite),
    respondJointSession: jest.fn(async (_id: string, _accept: boolean) => undefined),
    cancelJointSession: jest.fn(async () => undefined),
    proposeJointSession: jest.fn(async (_draft: JointSessionDraft) => proposed),
    listWorkouts: jest.fn(async () => [workout({ date: tomorrow, startTime: '18:00' })]),
    listBusyBlocks: jest.fn(async () => []),
    getFriendWeek: jest.fn(async () => [friendItem({ date: tomorrow, sport: 'run', startTime: '18:15', durationMin: 50 })]),
    searchProfiles: jest.fn(async () => [{ id: 'u-ivan', username: 'ivan', displayName: 'Iván', avatarUrl: null, sports: [] }]),
    sendFriendRequest: jest.fn(async (_username: string) => undefined),
    respondFriendRequest: jest.fn(async () => undefined),
    removeFriend: jest.fn(async () => undefined),
    subscribe: jest.fn(() => () => undefined),
  };
}

let repo = makeRepo();

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } },
  });
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
  repo = makeRepo();
  mockParams = {};
});

describe('Juntos', () => {
  test('shows friends, requests, quedada invites and the feed', async () => {
    await render(<TogetherScreen />, { wrapper: Providers });
    expect(await screen.findByText('Álex completó Rodaje Z2')).toBeTruthy();
    // v2: a stack screen; the title "Juntos" lives in the native header (root stack).
    expect(screen.getByText('1 amigo')).toBeTruthy();
    expect(await screen.findByText('Huecos comunes')).toBeTruthy();
    expect(screen.getByText('Marta')).toBeTruthy();
    expect(await screen.findByText('Te han invitado')).toBeTruthy();
  });

  test('actionable blocks come first, each with a sentence-case header', async () => {
    await render(<TogetherScreen />, { wrapper: Providers });
    await screen.findByText('Álex completó Rodaje Z2');
    await screen.findByText('Huecos comunes');
    const headers = screen.getAllByRole('header').map((h) => {
      const children = h.props.children as unknown;
      return Array.isArray(children) ? children.join('') : String(children);
    });
    const order = ['Solicitud de amistad', 'Próximas quedadas', 'Tú y Álex', 'Actividad'].map((title) => headers.indexOf(title));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(headers.filter((h) => h.length > 3 && h === h.toUpperCase())).toEqual([]);
  });

  test('"Proponer quedada" is the primary action and prefills the selected friend', async () => {
    await render(<TogetherScreen />, { wrapper: Providers });
    // The quick action comes first; opportunity cards below repeat it as secondary buttons.
    const [primary] = await screen.findAllByRole('button', { name: 'Proponer quedada' });
    await fireEvent.press(primary as never);
    expect(mockRouter.push).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/joint/new', params: expect.objectContaining({ friendId: ALEX }) }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Añadir amigo' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/friends/add');
  });

  test('accepting an invite inline calls the repository', async () => {
    await render(<TogetherScreen />, { wrapper: Providers });
    const accept = await screen.findAllByRole('button', { name: 'Aceptar' });
    // First "Aceptar" is Marta's friend request, the quedada invite comes later.
    await fireEvent.press(accept[accept.length - 1] as never);
    await waitFor(() => expect(repo.respondJointSession).toHaveBeenCalledWith('j-invite', true));
  });
});

describe('friend week', () => {
  test('renders seven day cards and proposes from the footer', async () => {
    mockParams = { id: ALEX };
    await render(<FriendWeekScreen />, { wrapper: Providers });
    expect(await screen.findByText('Álex García')).toBeTruthy();
    expect(await screen.findByText('Hueco común')).toBeTruthy();
    const propose = screen.getAllByRole('button', { name: 'Proponer quedada' });
    await fireEvent.press(propose[propose.length - 1] as never);
    expect(mockRouter.push).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/joint/new' }));
  });

  test('unknown friend shows an empty state', async () => {
    mockParams = { id: 'nobody' };
    await render(<FriendWeekScreen />, { wrapper: Providers });
    expect(await screen.findByText('No es tu amigo todavía')).toBeTruthy();
  });

  test('removing a friend returns to the Juntos tab without stacking another tab bar', async () => {
    const confirmSpy = jest.spyOn(confirm, 'confirmAction').mockResolvedValue(true);
    const menuSpy = jest
      .spyOn(confirm, 'showActionMenu')
      .mockImplementation((_title, options) => options[0]?.onSelect());
    mockParams = { id: ALEX };
    await render(<FriendWeekScreen />, { wrapper: Providers });
    await screen.findByText('Álex García');
    await fireEvent.press(screen.getByRole('button', { name: 'Opciones de amistad' }));
    await waitFor(() => expect(repo.removeFriend).toHaveBeenCalled());
    await waitFor(() => expect(mockRouter.dismissTo).toHaveBeenCalledWith('/together'));
    expect(mockRouter.push).not.toHaveBeenCalledWith('/together');
    confirmSpy.mockRestore();
    menuSpy.mockRestore();
  });
});

describe('joint/new', () => {
  test('submits a prefilled quedada and opens it', async () => {
    mockParams = { friendId: ALEX, date: tomorrow, sport: 'run', startTime: '18:00', durationMin: '60', title: 'Rodaje juntos' };
    await render(<JointNewScreen />, { wrapper: Providers });
    await fireEvent.press(await screen.findByRole('button', { name: 'Enviar invitación' }));
    await waitFor(() => expect(repo.proposeJointSession).toHaveBeenCalled());
    const draft = repo.proposeJointSession.mock.calls[0]?.[0];
    expect(draft).toMatchObject({ inviteeIds: [ALEX], date: tomorrow, startTime: '18:00', sport: 'run', title: 'Rodaje juntos' });
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/joint/j-new'));
  });

  test('shows overlaps for me and the friend', async () => {
    mockParams = { friendId: ALEX, date: tomorrow, startTime: '18:00', sport: 'bike' };
    await render(<JointNewScreen />, { wrapper: Providers });
    expect(await screen.findByText('Álex tiene «Técnica» 18:15–19:05')).toBeTruthy();
    expect(await screen.findByText('Tienes «Rodaje Z2» 18:00–19:00')).toBeTruthy();
  });

  test('a same-sport overlap is offered as a match', async () => {
    mockParams = { friendId: ALEX, date: tomorrow, startTime: '18:00', sport: 'run' };
    await render(<JointNewScreen />, { wrapper: Providers });
    expect(await screen.findByText('Álex tiene «Técnica» 18:15–19:05: mismo deporte, ¿lo hacéis juntos?')).toBeTruthy();
  });
});

describe('joint/[id]', () => {
  test('invitee can accept', async () => {
    mockParams = { id: 'j-invite' };
    await render(<JointSessionScreen />, { wrapper: Providers });
    expect(await screen.findByText('Rodaje largo')).toBeTruthy();
    expect(screen.getByText('Invitado')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Aceptar' }));
    await waitFor(() => expect(repo.respondJointSession).toHaveBeenCalledWith('j-invite', true));
  });

  test('a missing quedada goes back to the Juntos tab', async () => {
    repo.getJointSession.mockResolvedValueOnce(null as never);
    mockParams = { id: 'gone' };
    await render(<JointSessionScreen />, { wrapper: Providers });
    await fireEvent.press(await screen.findByRole('button', { name: 'Volver a Juntos' }));
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/together');
  });
});

describe('notifications', () => {
  test('tapping marks as read and opens the link', async () => {
    await render(<NotificationsScreen />, { wrapper: Providers });
    expect(await screen.findByText('Hoy')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /Álex te invita/ }));
    await waitFor(() => expect(repo.markNotificationsRead).toHaveBeenCalledWith(['n1']));
    expect(mockRouter.push).toHaveBeenCalledWith('/joint/j-invite');
  });
});

describe('friends/add', () => {
  test('searches after debounce and sends a request', async () => {
    await render(<AddFriendScreen />, { wrapper: Providers });
    expect(await screen.findByText('@diego')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Buscar amigos por usuario o nombre'), 'iv');
    expect(await screen.findByText('Iván', {}, { timeout: 2000 })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Añadir' }));
    await waitFor(() => expect(repo.sendFriendRequest).toHaveBeenCalledWith('ivan'));
    await waitFor(() => expect(repo.listFriends.mock.calls.length).toBeGreaterThan(1));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Añadir' }).props.accessibilityState).toMatchObject({ busy: false }),
    );
  });
});
