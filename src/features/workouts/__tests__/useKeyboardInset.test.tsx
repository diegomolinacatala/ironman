import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';
import { Keyboard, LayoutAnimation, View, type KeyboardEvent } from 'react-native';

import { useKeyboardInset } from '../useKeyboardInset';

jest.mock(
  'react-native-safe-area-context',
  () => (jest.requireActual('react-native-safe-area-context/jest/mock') as { default: object }).default,
);

type Handler = (event: KeyboardEvent) => void;
const handlers: Record<string, Handler> = {};
let probe: ReturnType<typeof useKeyboardInset> | null = null;

function Probe() {
  const keyboard = useKeyboardInset();
  probe = keyboard;
  return <View ref={keyboard.ref} testID="probe" style={{ paddingBottom: keyboard.inset }} />;
}

function keyboardEvent(screenY: number): KeyboardEvent {
  return {
    duration: 250,
    easing: 'keyboard',
    startCoordinates: { screenX: 0, screenY: 812, width: 375, height: 0 },
    endCoordinates: { screenX: 0, screenY, width: 375, height: 812 - screenY },
  } as KeyboardEvent;
}

beforeEach(() => {
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((name: string, handler: Handler) => {
    handlers[name] = handler;
    return { remove: jest.fn() };
  }) as unknown as typeof Keyboard.addListener);
  jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  probe = null;
});

describe('useKeyboardInset (iOS)', () => {
  test('pads the view by the part the keyboard covers, measured in window coordinates', async () => {
    await render(<Probe />);
    const node = probe?.ref.current as unknown as { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void };
    // A modal sheet: the view starts 60 pt below the top of the screen and reaches its bottom.
    node.measureInWindow = (cb) => cb(0, 60, 375, 752);
    await act(async () => handlers.keyboardWillChangeFrame?.(keyboardEvent(476)));
    expect(screen.getByTestId('probe').props.style).toMatchObject({ paddingBottom: 336 });
    await act(async () => handlers.keyboardWillHide?.(keyboardEvent(812)));
    expect(screen.getByTestId('probe').props.style).toMatchObject({ paddingBottom: 0 });
  });
});
