import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import NotificationsScreen from '@/app/notifications';
import type { AppNotification } from '@/domain/types';
import { notification } from '@/features/together/__tests__/fixtures';

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  dismissTo: jest.fn(),
  canGoBack: jest.fn(() => true),
};
const mockMarkRead = jest.fn();
let mockItems: AppNotification[] = [];

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
}));
jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);
jest.mock('@/data/queries', () => ({
  useNotifications: () => ({ data: mockItems, isLoading: false, error: null, isRefetching: false, refetch: jest.fn() }),
  useMarkNotificationsRead: () => ({ mutate: mockMarkRead, mutateAsync: jest.fn(), isPending: false, variables: undefined }),
}));

jest.setTimeout(30000);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Avisos', () => {
  test('a friend request goes back to Juntos (even an old row linking the inbox) instead of stacking another inbox', async () => {
    mockItems = [
      notification({ id: 'fr', type: 'friend_request', title: 'Lucía quiere ser tu amiga', body: '', data: { url: '/notifications' } }),
    ];
    await render(<NotificationsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: /Lucía quiere ser tu amiga/ }));
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/together');
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockMarkRead).toHaveBeenCalledWith(['fr'], expect.anything());
  });

  test('detail links are pushed on top', async () => {
    mockItems = [notification({ id: 'ji', data: { url: '/joint/j1' } })];
    await render(<NotificationsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: /Álex te invita/ }));
    expect(mockRouter.push).toHaveBeenCalledWith('/joint/j1');
    expect(mockRouter.dismissTo).not.toHaveBeenCalled();
  });
});
