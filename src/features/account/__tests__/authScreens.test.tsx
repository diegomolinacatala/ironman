import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import SignInScreen from '@/app/sign-in';
import VerifyScreen from '@/app/verify';

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
  canDismiss: jest.fn(() => true),
  dismissAll: jest.fn(),
};

const mockAuth = {
  sendEmailCode: jest.fn(async (_email: string) => undefined),
  verifyEmailCode: jest.fn(async (_email: string, _code: string) => ({ userId: 'u1', email: 'demo@roadtoironman.app' })),
  signInWithApple: jest.fn(async () => ({ userId: 'u1', email: null })),
};

// Getter: the factory runs before `mockRouter` is initialised (jest.mock is hoisted).
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useLocalSearchParams: () => ({ email: 'diego@roadtoironman.app' }),
}));

jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);

jest.mock('@/data/context', () => ({
  useAuth: () => ({ session: null, isLoading: false, auth: mockAuth, mode: 'demo' }),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('sign-in', () => {
  test('sends the email code and navigates to verify', async () => {
    await render(<SignInScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText('tu@email.com'), ' Diego@RoadToIronman.app ');
    await fireEvent.press(screen.getByRole('button', { name: 'Recibir código' }));
    await waitFor(() => expect(mockAuth.sendEmailCode).toHaveBeenCalledWith('diego@roadtoironman.app'));
    await waitFor(() =>
      expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/verify', params: { email: 'diego@roadtoironman.app' } }),
    );
  });

  test('demo mode enters with the demo credentials', async () => {
    await render(<SignInScreen />);
    expect(screen.getByText('Modo demo: sin servidor, datos de ejemplo')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Entrar en modo demo' }));
    await waitFor(() => expect(mockAuth.verifyEmailCode).toHaveBeenCalledWith('demo@roadtoironman.app', '000000'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'));
  });

  test('shows an inline error when sending fails', async () => {
    mockAuth.sendEmailCode.mockRejectedValueOnce(new Error('Servidor caído'));
    await render(<SignInScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText('tu@email.com'), 'diego@roadtoironman.app');
    await fireEvent.press(screen.getByRole('button', { name: 'Recibir código' }));
    expect(await screen.findByText('Servidor caído')).toBeTruthy();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });
});

describe('verify', () => {
  test('auto-submits when six digits are typed', async () => {
    await render(<VerifyScreen />);
    await fireEvent.changeText(screen.getByLabelText('Código de 6 dígitos'), '12a3456');
    await waitFor(() => expect(mockAuth.verifyEmailCode).toHaveBeenCalledWith('diego@roadtoironman.app', '123456'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'));
  });

  test('wrong code shows an error and keeps the user on the screen', async () => {
    mockAuth.verifyEmailCode.mockRejectedValueOnce(new Error('Código incorrecto'));
    await render(<VerifyScreen />);
    await fireEvent.changeText(screen.getByLabelText('Código de 6 dígitos'), '000111');
    expect(await screen.findByText('Código incorrecto')).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  test('resend is disabled during the cooldown', async () => {
    await render(<VerifyScreen />);
    const resend = screen.getByRole('button', { name: /Reenviar en \d+s/ });
    expect(resend.props.accessibilityState?.disabled).toBe(true);
  });
});
