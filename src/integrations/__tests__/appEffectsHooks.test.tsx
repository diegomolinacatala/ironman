/**
 * AppEffects building blocks: OS cleanup whenever there is no session (also a
 * session dropped at launch), and push registration once per account.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';

import { usePushRegistration } from '../effects/usePushRegistration';
import { useSignedOutCleanup } from '../effects/useSignedOutCleanup';

const mockCancel = jest.fn(async () => undefined);
const mockClearWidgets = jest.fn(() => undefined);
const mockRegister = jest.fn(async (_repo: unknown) => 'ExponentPushToken[abc]');

jest.mock('../notifications', () => ({
  cancelLocalNotifications: () => mockCancel(),
  registerForPush: (repo: unknown) => mockRegister(repo),
}));
jest.mock('../widgets/sync', () => ({ clearWidgets: () => mockClearWidgets() }));

const repo = {} as never;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useSignedOutCleanup', () => {
  test('waits while the session is being restored', async () => {
    await renderHook(() => useSignedOutCleanup(true, null));
    expect(mockCancel).not.toHaveBeenCalled();
    expect(mockClearWidgets).not.toHaveBeenCalled();
  });

  test('cleans up when the app starts without a session (revoked elsewhere)', async () => {
    const { rerender } = await renderHook((props: { isLoading: boolean; userId: string | null }) => useSignedOutCleanup(props.isLoading, props.userId), {
      initialProps: { isLoading: true, userId: null },
    });
    await rerender({ isLoading: false, userId: null });
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockClearWidgets).toHaveBeenCalledTimes(1);
  });

  test('cleans up on sign-out but never while signed in', async () => {
    const { rerender } = await renderHook((props: { userId: string | null }) => useSignedOutCleanup(false, props.userId), {
      initialProps: { userId: 'user-ana' as string | null },
    });
    expect(mockCancel).not.toHaveBeenCalled();
    await rerender({ userId: null });
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockClearWidgets).toHaveBeenCalledTimes(1);
  });
});

describe('usePushRegistration', () => {
  test('registers once per account and again after signing out and back in', async () => {
    const { rerender } = await renderHook(
      (props: { enabled: boolean; userId: string | null }) => usePushRegistration(props.enabled, props.userId, repo),
      { initialProps: { enabled: true, userId: 'user-ana' as string | null } },
    );
    await rerender({ enabled: true, userId: 'user-ana' });
    expect(mockRegister).toHaveBeenCalledTimes(1);

    await rerender({ enabled: false, userId: null });
    await rerender({ enabled: true, userId: 'user-ana' });
    expect(mockRegister).toHaveBeenCalledTimes(2);

    await rerender({ enabled: true, userId: 'user-bea' });
    expect(mockRegister).toHaveBeenCalledTimes(3);
  });

  test('does not register before the account is ready', async () => {
    await renderHook(() => usePushRegistration(false, 'user-ana', repo));
    expect(mockRegister).not.toHaveBeenCalled();
  });
});
