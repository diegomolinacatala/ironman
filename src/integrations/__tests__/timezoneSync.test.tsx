import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react-native';

import { deviceTimeZone, timezoneToSync, useTimezoneSync } from '../effects/useTimezoneSync';

const mockUpdate = jest.fn(async (_patch: { timezone: string }) => ({}));

jest.mock('@/data/queries', () => ({
  useUpdateProfile: () => ({ mutateAsync: mockUpdate }),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('timezoneToSync', () => {
  test('only a valid zone different from the profile one', () => {
    expect(timezoneToSync('Europe/Madrid', 'Atlantic/Canary')).toBe('Atlantic/Canary');
    expect(timezoneToSync('Europe/Madrid', 'Europe/Madrid')).toBeNull();
    expect(timezoneToSync('Europe/Madrid', null)).toBeNull();
    expect(timezoneToSync('Europe/Madrid', 'not a zone; drop table')).toBeNull();
    expect(timezoneToSync('Europe/Madrid', 'America/Argentina/Buenos_Aires')).toBe('America/Argentina/Buenos_Aires');
    expect(timezoneToSync('Europe/Madrid', 'Etc/GMT+3')).toBe('Etc/GMT+3');
  });

  test('the device reports an IANA zone', () => {
    expect(deviceTimeZone()).toMatch(/\w/);
  });
});

describe('useTimezoneSync', () => {
  test('saves the device zone once when it differs from the profile', async () => {
    const device = deviceTimeZone() ?? 'UTC';
    const other = device === 'Atlantic/Canary' ? 'Europe/Madrid' : 'Atlantic/Canary';
    const { rerender } = await renderHook(({ zone }: { zone: string }) => useTimezoneSync(true, { timezone: zone }), {
      initialProps: { zone: other },
    });
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({ timezone: device }));
    await rerender({ zone: other });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  test('nothing while signed out or already in sync', async () => {
    await renderHook(() => useTimezoneSync(false, { timezone: 'Atlantic/Canary' }));
    await renderHook(() => useTimezoneSync(true, { timezone: deviceTimeZone() ?? 'UTC' }));
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
