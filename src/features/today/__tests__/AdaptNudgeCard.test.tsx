import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { stressSignal } from '../../stress/__tests__/stressFixtures';
import type { AdaptNudge } from '../adaptNudge';
import { AdaptNudgeCard } from '../AdaptNudgeCard';

const TODAY = '2026-10-28';
const mockRouter = { push: jest.fn() };
const mockRun = jest.fn(async () => undefined);
const mockDismiss = jest.fn();
const mockState: { nudge: AdaptNudge | null } = { nudge: null };

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
}));

jest.mock('../useAdaptNudge', () => ({
  useAdaptNudge: () => ({ nudge: mockState.nudge, run: mockRun, dismiss: mockDismiss, busy: false, message: null }),
}));

function stressNudge(action: string | null): AdaptNudge {
  return {
    kind: 'stress',
    key: `stress:${TODAY}`,
    signal: stressSignal(TODAY),
    title: 'Estrés alto 2 días y dormiste 1 h menos de lo habitual',
    detail: '¿Suavizo hoy y mañana, manteniendo lo clave? Esta noche, acuéstate antes.',
    action,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockState.nudge = null;
});

describe('AdaptNudgeCard — stress costing sleep', () => {
  test('ease the next days, or open the guided breathing', async () => {
    mockState.nudge = stressNudge('Suavizar');
    await render(<AdaptNudgeCard today={TODAY} checkinDone />);
    expect(screen.getByText('Estrés alto 2 días y dormiste 1 h menos de lo habitual')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Suavizar' }));
    expect(mockRun).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Respirar 3 min' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/breathing');
    await fireEvent.press(screen.getByRole('button', { name: 'Ahora no' }));
    expect(mockDismiss).toHaveBeenCalledTimes(1);
  });

  test('nothing to ease: only breathing and «Ahora no»', async () => {
    mockState.nudge = stressNudge(null);
    await render(<AdaptNudgeCard today={TODAY} checkinDone />);
    expect(screen.queryByRole('button', { name: 'Suavizar' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Respirar 3 min' })).toBeTruthy();
  });

  test('other nudges have no breathing button', async () => {
    mockState.nudge = { kind: 'readiness', key: `readiness:${TODAY}`, level: 'amber', title: 'Hoy vas algo justo', detail: '…', action: 'Adaptar hoy' };
    await render(<AdaptNudgeCard today={TODAY} checkinDone={false} />);
    expect(screen.getByRole('button', { name: 'Adaptar hoy' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Respirar 3 min' })).toBeNull();
  });
});
