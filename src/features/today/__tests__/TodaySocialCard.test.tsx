import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ALEX, jointSession, ME, participant } from '@/features/together/__tests__/fixtures';

import { TodaySocialCard } from '../TodaySocialCard';

const mockRouter = { push: jest.fn(), navigate: jest.fn() };

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
}));

const TODAY = '2026-10-27';
const NOW = new Date('2026-10-27T12:00:00Z');

function todaySession(overrides: Parameters<typeof jointSession>[0] = {}) {
  return jointSession({
    id: 'j-today',
    date: TODAY,
    startTime: '07:30',
    status: 'confirmed',
    location: 'Retiro',
    participants: [participant({ userId: ALEX, displayName: 'Álex' }), participant()],
    ...overrides,
  });
}

beforeEach(() => {
  mockRouter.push.mockClear();
  mockRouter.navigate.mockClear();
});

describe('TodaySocialCard', () => {
  test('hidden when there is no quedada today (discovery lives in the Juntos tab)', async () => {
    await render(<TodaySocialCard myId={ME} today={TODAY} jointSessions={[]} now={NOW} />);
    expect(screen.queryByText('Juntos hoy')).toBeNull();
  });

  test('hidden for quedadas on other days or cancelled ones', async () => {
    const other = todaySession({ id: 'tomorrow', date: '2026-10-28' });
    const cancelled = todaySession({ id: 'cancelled', status: 'cancelled' });
    await render(<TodaySocialCard myId={ME} today={TODAY} jointSessions={[other, cancelled]} now={NOW} />);
    expect(screen.queryByText('Juntos hoy')).toBeNull();
  });

  test("today's quedada opens it; the header switches to the Juntos tab", async () => {
    await render(<TodaySocialCard myId={ME} today={TODAY} jointSessions={[todaySession()]} now={NOW} />);
    expect(screen.getByText('Hoy entrenas con Álex a las 07:30')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /Hoy entrenas con Álex/ }));
    expect(mockRouter.push).toHaveBeenCalledWith('/joint/j-today');
    await fireEvent.press(screen.getByRole('button', { name: 'Ver Juntos' }));
    expect(mockRouter.navigate).toHaveBeenCalledWith('/together');
    expect(mockRouter.push).not.toHaveBeenCalledWith('/together');
  });
});
