import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { Alert } from 'react-native';

import { describeFatal, installFatalErrorAlert, type ErrorUtilsLike } from '../fatalErrors';

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

function fakeErrorUtils() {
  const previous = jest.fn<(error: unknown, isFatal?: boolean) => void>();
  let handler = previous as (error: unknown, isFatal?: boolean) => void;
  const errorUtils: ErrorUtilsLike = {
    getGlobalHandler: () => handler,
    setGlobalHandler: (next) => {
      handler = next;
    },
  };
  return { errorUtils, previous, raise: (error: unknown, isFatal: boolean) => handler(error, isFatal) };
}

describe('fatal JS errors in release builds', () => {
  test('shows the error instead of handing it to React Native (which aborts the app)', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { errorUtils, previous, raise } = fakeErrorUtils();
    installFatalErrorAlert(errorUtils, false);

    raise(new Error('Exception in HostFunction: boom'), true);

    expect(previous).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0]?.[1]).toContain('Exception in HostFunction: boom');
    alert.mockRestore();
  });

  test('shows only the first fatal error', () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { errorUtils, raise } = fakeErrorUtils();
    installFatalErrorAlert(errorUtils, false);

    raise(new Error('first'), true);
    raise(new Error('second'), true);

    expect(alert).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });

  test('passes non-fatal errors to the previous handler', () => {
    const { errorUtils, previous, raise } = fakeErrorUtils();
    installFatalErrorAlert(errorUtils, false);
    const error = new Error('soft');

    raise(error, false);

    expect(previous).toHaveBeenCalledWith(error, false);
  });

  test('leaves development builds (red box) alone', () => {
    const { errorUtils, previous, raise } = fakeErrorUtils();
    installFatalErrorAlert(errorUtils, true);
    const error = new Error('dev');

    raise(error, true);

    expect(previous).toHaveBeenCalledWith(error, true);
  });

  test('does nothing without ErrorUtils (web)', () => {
    expect(() => installFatalErrorAlert(undefined, false)).not.toThrow();
  });
});

describe('describeFatal', () => {
  test('includes the message and the top of the stack', () => {
    const error = new Error('boom');
    error.stack = ['Error: boom', ...Array.from({ length: 20 }, (_, i) => `    at fn${i} (index.bundle:1:${i})`)].join('\n');

    const text = describeFatal(error);

    expect(text.startsWith('boom')).toBe(true);
    expect(text).toContain('fn0');
    expect(text).not.toContain('fn19');
  });

  test('describes values that are not Error objects', () => {
    expect(describeFatal('plain text')).toBe('plain text');
    expect(describeFatal({ code: 42 })).toBe('{"code":42}');
  });
});
