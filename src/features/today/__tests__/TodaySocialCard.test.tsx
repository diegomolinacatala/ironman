import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { FeedItem, Friend, JointSession } from '@/domain/types';
import { ALEX, feedItem, jointSession, ME, participant } from '@/features/together/__tests__/fixtures';

import { TodaySocialCard } from '../TodaySocialCard';

const mockRouter = { push: jest.fn() };
let mockFriends: Friend[] = [];
let mockFeed: FeedItem[] = [];
let mockOpen: JointSession[] = [];

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
}));
jest.mock('@/data/queries', () => ({
  useFriends: () => ({ data: mockFriends }),
  useFeed: () => ({ data: mockFeed }),
  useOpenJointSessions: () => ({ data: mockOpen }),
  useJoinJointSession: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

const TODAY = '2026-10-27';
const NOW = new Date('2026-10-27T12:00:00Z');

const alex: Friend = {
  friendshipId: 'fs1',
  status: 'accepted',
  direction: 'incoming',
  createdAt: '2026-10-01T00:00:00Z',
  profile: { id: ALEX, username: 'alex', displayName: 'Álex García', avatarUrl: null, sports: ['run'] },
} as Friend;

beforeEach(() => {
  mockRouter.push.mockClear();
  mockFriends = [alex];
  mockFeed = [];
  mockOpen = [];
});

describe('TodaySocialCard', () => {
  test('hidden without friends', async () => {
    mockFriends = [];
    await render(<TodaySocialCard myId={ME} today={TODAY} jointSessions={[]} now={NOW} />);
    expect(screen.queryByText(/Juntos/)).toBeNull();
  });

  test('quiet link to Juntos when nothing social is happening', async () => {
    await render(<TodaySocialCard myId={ME} today={TODAY} jointSessions={[]} now={NOW} />);
    await fireEvent.press(screen.getByRole('button', { name: /Busca un hueco para entrenar con Álex/ }));
    expect(mockRouter.push).toHaveBeenCalledWith('/together');
  });

  test("today's quedada, a friend's recent activity and an open quedada", async () => {
    mockFeed = [feedItem({ createdAt: '2026-10-27T08:00:00Z' })];
    mockOpen = [jointSession({ id: 'open1', isOpen: true, title: 'Series abiertas', participants: [participant({ userId: ALEX, displayName: 'Álex' })] })];
    const today = jointSession({
      id: 'j-today',
      date: TODAY,
      startTime: '07:30',
      status: 'confirmed',
      location: 'Retiro',
      participants: [participant({ userId: ALEX, displayName: 'Álex' }), participant()],
    });
    await render(<TodaySocialCard myId={ME} today={TODAY} jointSessions={[today]} now={NOW} />);
    expect(screen.getByText('Hoy entrenas con Álex a las 07:30')).toBeTruthy();
    expect(screen.getByText('Álex completó Rodaje Z2')).toBeTruthy();
    expect(screen.getByText('Álex abre una quedada: Series abiertas')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /Hoy entrenas con Álex/ }));
    expect(mockRouter.push).toHaveBeenCalledWith('/joint/j-today');
  });
});
