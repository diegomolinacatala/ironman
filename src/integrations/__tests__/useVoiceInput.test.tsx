/**
 * useVoiceInput against a fake expo-speech-recognition: permission flow, transcript
 * accumulation from events, auto-stop after 90 s, cancel and cleanup on unmount.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';

import { MAX_TAKE_MS, useVoiceInput } from '../speech/useVoiceInput';

interface FakeRecognition {
  listeners: Record<string, (event: unknown) => void>;
  module: {
    isRecognitionAvailable: jest.Mock<() => boolean>;
    requestPermissionsAsync: jest.Mock<() => Promise<{ granted: boolean }>>;
    start: jest.Mock<(options: Record<string, unknown>) => void>;
    stop: jest.Mock<() => void>;
    abort: jest.Mock<() => void>;
  };
}

jest.mock('expo-speech-recognition', () => {
  const fake = {
    listeners: {} as Record<string, (event: unknown) => void>,
    module: {
      isRecognitionAvailable: jest.fn(() => true),
      requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
      start: jest.fn(),
      stop: jest.fn(),
      abort: jest.fn(),
    },
  };
  return {
    fake,
    ExpoSpeechRecognitionModule: fake.module,
    useSpeechRecognitionEvent: (name: string, listener: (event: unknown) => void) => {
      fake.listeners[name] = listener;
    },
  };
});

const { fake } = jest.requireMock<{ fake: FakeRecognition }>('expo-speech-recognition');

async function emit(name: string, event: unknown = null): Promise<void> {
  await act(async () => {
    fake.listeners[name]?.(event);
  });
}

function result(isFinal: boolean, transcript: string) {
  return { isFinal, results: [{ transcript, confidence: 0.9, segments: [] }] };
}

beforeEach(() => {
  jest.clearAllMocks();
  fake.module.isRecognitionAvailable.mockReturnValue(true);
  fake.module.requestPermissionsAsync.mockResolvedValue({ granted: true });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useVoiceInput', () => {
  test('asks permission, listens in Spanish and accumulates what is said', async () => {
    const { result: hook } = await renderHook(() => useVoiceInput());
    expect(hook.current.available).toBe(true);
    expect(hook.current.state).toBe('idle');

    await act(async () => {
      await hook.current.start();
    });
    expect(fake.module.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(fake.module.start).toHaveBeenCalledWith(
      expect.objectContaining({
        lang: 'es-ES',
        interimResults: true,
        continuous: true,
        addsPunctuation: true,
        iosTaskHint: 'dictation',
        contextualStrings: expect.arrayContaining(['tirada larga']),
      }),
    );

    await emit('start');
    expect(hook.current.state).toBe('listening');
    await emit('volumechange', { value: 5 });
    expect(hook.current.level).toBe(0.5);
    await emit('result', result(false, 'Hoy me duele'));
    expect(hook.current.transcript).toBe('Hoy me duele');
    await emit('result', result(true, 'Hoy me duele el gemelo.'));
    await emit('result', result(false, ' Mañana descanso'));
    expect(hook.current.transcript).toBe('Hoy me duele el gemelo. Mañana descanso');

    await act(async () => {
      hook.current.stop();
    });
    expect(fake.module.stop).toHaveBeenCalledTimes(1);
    expect(hook.current.state).toBe('stopping');
    await emit('result', result(true, ' Mañana descanso.'));
    await emit('end');
    expect(hook.current.state).toBe('idle');
    expect(hook.current.level).toBe(0);
    expect(hook.current.transcript).toBe('Hoy me duele el gemelo. Mañana descanso.');
  });

  test('denied permission explains Ajustes and never starts the microphone', async () => {
    fake.module.requestPermissionsAsync.mockResolvedValue({ granted: false });
    const { result: hook } = await renderHook(() => useVoiceInput());
    await act(async () => {
      await hook.current.start();
    });
    expect(fake.module.start).not.toHaveBeenCalled();
    expect(hook.current.state).toBe('error');
    expect(hook.current.error).toMatch(/Ajustes/);

    await act(async () => {
      hook.current.reset();
    });
    expect(hook.current.state).toBe('idle');
    expect(hook.current.error).toBeNull();
  });

  test('unavailable recognition offers the keyboard', async () => {
    fake.module.isRecognitionAvailable.mockReturnValue(false);
    const { result: hook } = await renderHook(() => useVoiceInput());
    expect(hook.current.available).toBe(false);
    expect(hook.current.state).toBe('unavailable');
    await act(async () => {
      await hook.current.start();
    });
    expect(fake.module.start).not.toHaveBeenCalled();
    expect(hook.current.error).toMatch(/teclado/);
  });

  test('stops by itself after 90 seconds', async () => {
    jest.useFakeTimers();
    const { result: hook } = await renderHook(() => useVoiceInput());
    await act(async () => {
      await hook.current.start();
    });
    await act(async () => {
      jest.advanceTimersByTime(MAX_TAKE_MS);
    });
    expect(fake.module.stop).toHaveBeenCalledTimes(1);
  });

  test('cancel discards the take; silence errors after speech are not shown', async () => {
    const { result: hook } = await renderHook(() => useVoiceInput());
    await act(async () => {
      await hook.current.start();
    });
    await emit('result', result(true, 'Algo'));
    await emit('error', { error: 'no-speech', message: 'silence' });
    expect(hook.current.error).toBeNull();

    await act(async () => {
      hook.current.cancel();
    });
    expect(fake.module.abort).toHaveBeenCalledTimes(1);
    await emit('result', result(true, 'ignorado'));
    await emit('end');
    expect(hook.current.transcript).toBe('');
    expect(hook.current.state).toBe('idle');
  });

  test('leaving the screen while listening aborts recognition', async () => {
    const { result: hook, unmount } = await renderHook(() => useVoiceInput());
    await act(async () => {
      await hook.current.start();
    });
    await unmount();
    expect(fake.module.abort).toHaveBeenCalledTimes(1);
  });

  test('a double tap while starting or listening starts only one take', async () => {
    let grant: (value: { granted: boolean }) => void = () => undefined;
    fake.module.requestPermissionsAsync.mockImplementation(
      () => new Promise<{ granted: boolean }>((resolve) => {
        grant = resolve;
      }),
    );
    const { result: hook } = await renderHook(() => useVoiceInput());
    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = hook.current.start();
      void hook.current.start();
    });
    expect(fake.module.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    await act(async () => {
      grant({ granted: true });
      await first;
    });
    expect(fake.module.start).toHaveBeenCalledTimes(1);

    await act(async () => {
      await hook.current.start();
    });
    expect(fake.module.start).toHaveBeenCalledTimes(1);
    expect(fake.module.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  test('cancelling while the permission prompt is up never turns the microphone on', async () => {
    let grant: (value: { granted: boolean }) => void = () => undefined;
    fake.module.requestPermissionsAsync.mockImplementation(
      () => new Promise<{ granted: boolean }>((resolve) => {
        grant = resolve;
      }),
    );
    const { result: hook } = await renderHook(() => useVoiceInput());
    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = hook.current.start();
    });
    await act(async () => {
      hook.current.cancel();
    });
    expect(hook.current.state).toBe('idle');
    await act(async () => {
      grant({ granted: true });
      await pending;
    });
    expect(fake.module.start).not.toHaveBeenCalled();
  });

  test('a new take after the previous one ended restarts the 90 s timer', async () => {
    jest.useFakeTimers();
    const { result: hook } = await renderHook(() => useVoiceInput());
    await act(async () => {
      await hook.current.start();
    });
    await emit('end');
    await act(async () => {
      jest.advanceTimersByTime(MAX_TAKE_MS / 2);
      await hook.current.start();
    });
    await act(async () => {
      jest.advanceTimersByTime(MAX_TAKE_MS / 2 + 1);
    });
    expect(fake.module.stop).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(MAX_TAKE_MS / 2);
    });
    expect(fake.module.stop).toHaveBeenCalledTimes(1);
  });
});
