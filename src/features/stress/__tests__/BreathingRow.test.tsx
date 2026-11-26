import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import BreathingScreen from '@/app/breathing';

import { BreathingRow } from '../BreathingRow';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  Stack: { Screen: () => null },
}));

jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);

describe('Respiración guiada', () => {
  test('Tú › Tu coach opens /breathing', async () => {
    await render(<BreathingRow />);
    await fireEvent.press(screen.getByText('Respiración guiada'));
    expect(mockRouter.push).toHaveBeenCalledWith('/breathing');
  });

  test('the /breathing route shows the session', async () => {
    await render(<BreathingScreen />);
    expect(screen.getByText('Respira despacio')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Empezar' })).toBeTruthy();
  });
});
