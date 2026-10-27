import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { CoachAccessory } from '../CoachAccessory';
import { MEAL_CAMERA_ROUTE, TALK_ROUTE, hasNativeAccessory, needsInlineAccessory } from '../coachActions';

const mockRouter = { push: jest.fn() };

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('accessory platform rules', () => {
  test('native accessory only on iOS 26+', () => {
    expect(hasNativeAccessory('ios', '26.0')).toBe(true);
    expect(hasNativeAccessory('ios', '26.1.2')).toBe(true);
    expect(hasNativeAccessory('ios', '18.6')).toBe(false);
    expect(hasNativeAccessory('android', 35)).toBe(false);
    expect(hasNativeAccessory('web', '')).toBe(false);
  });

  test('inline fallback on Hoy where there is neither the native accessory nor the web bar', () => {
    expect(needsInlineAccessory('ios', '18.6')).toBe(true);
    expect(needsInlineAccessory('android', 35)).toBe(true);
    expect(needsInlineAccessory('ios', '26.0')).toBe(false);
    expect(needsInlineAccessory('web', '')).toBe(false);
  });
});

describe('CoachAccessory', () => {
  test('regular: talk to the coach or photograph a meal', async () => {
    await render(<CoachAccessory placement="regular" surface="floating" />);
    expect(screen.getByText('Cuéntaselo a tu coach')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Cuéntaselo a tu coach' }));
    expect(mockRouter.push).toHaveBeenCalledWith(TALK_ROUTE);
    await fireEvent.press(screen.getByRole('button', { name: 'Foto de tu comida' }));
    expect(mockRouter.push).toHaveBeenCalledWith(MEAL_CAMERA_ROUTE);
  });

  test('inline: icons only, still labelled', async () => {
    await render(<CoachAccessory placement="inline" surface="glass" />);
    expect(screen.queryByText('Cuéntaselo a tu coach')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Cuéntaselo a tu coach' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/talk');
    await fireEvent.press(screen.getByRole('button', { name: 'Foto de tu comida' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/meal?source=camera');
  });
});
