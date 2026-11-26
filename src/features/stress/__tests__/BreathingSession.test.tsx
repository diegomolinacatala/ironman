import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { BreathingSession } from '../BreathingSession';
import { BREATH, breathAt, clockText, remainingLabel } from '../breathingModel';

const mockHaptics = { tap: jest.fn(), success: jest.fn(), impact: jest.fn(), warning: jest.fn() };
jest.mock('@/ui/haptics', () => ({
  get haptics() {
    return mockHaptics;
  },
}));

describe('breathingModel', () => {
  test('inhale 4 s, exhale 6 s, three minutes', () => {
    expect(breathAt(0)).toMatchObject({ phase: 'inhale', phaseLeft: 4, breath: 1, remainingSec: 180, done: false });
    expect(breathAt(4)).toMatchObject({ phase: 'exhale', phaseLeft: 6, breath: 1 });
    expect(breathAt(9)).toMatchObject({ phase: 'exhale', phaseLeft: 1 });
    expect(breathAt(10)).toMatchObject({ phase: 'inhale', breath: 2 });
    expect(breathAt(BREATH.totalSec)).toMatchObject({ remainingSec: 0, done: true });
    expect(clockText(160)).toBe('2:40');
    expect(remainingLabel(160)).toBe('2 min 40 s');
    expect(remainingLabel(45)).toBe('45 s');
  });
});

describe('BreathingSession', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    Object.values(mockHaptics).forEach((fn) => fn.mockClear());
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('starts, guides inhale / exhale with the time left, pauses and resumes', async () => {
    const onClose = jest.fn();
    await render(<BreathingSession onClose={onClose} />);
    expect(screen.getByText('Respira despacio')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Empezar' }));
    expect(screen.getByText('Inspira')).toBeTruthy();
    expect(screen.getByText('3:00')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    expect(screen.getByText('Suelta el aire')).toBeTruthy();
    expect(screen.getByLabelText('Quedan 2 min 56 s')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Pausa' }));
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(screen.getByText('2:56')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Seguir' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Terminar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('soft vibration at each change of phase only when chosen, and a calm ending', async () => {
    const onClose = jest.fn();
    await render(<BreathingSession onClose={onClose} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Vibración suave' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Empezar' }));
    // Buttons tap on press: count only the phase changes from here.
    mockHaptics.tap.mockClear();
    for (let s = 0; s < 10; s += 1) {
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
    }
    // Inhale → exhale (4 s) and exhale → inhale (10 s).
    expect(mockHaptics.tap).toHaveBeenCalledTimes(2);
    for (let s = 10; s < BREATH.totalSec; s += 1) {
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
    }
    expect(screen.getByText('Tres minutos para ti')).toBeTruthy();
    expect(mockHaptics.success).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
