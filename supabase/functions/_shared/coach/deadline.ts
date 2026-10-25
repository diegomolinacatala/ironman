/**
 * Overall deadline of a coach job. The Edge wall clock ends the worker at
 * 150 s (Free plan) and the app stops polling shortly after, so the whole job
 * (context + Claude stream + writes) must end well before: on timeout the
 * Claude stream is aborted and the job is marked as failed (the app then
 * falls back to the rules engine).
 */
import { CoachAiError } from './ports.ts';

/** Budget of one job, measured from its start in the background task. */
export const COACH_DEADLINE_MS = 110_000;

export const TIMEOUT_MESSAGE = 'El coach con IA ha tardado demasiado. Te propongo el plan automático mientras tanto.';

export function timeoutError(): CoachAiError {
  return new CoachAiError('timeout', TIMEOUT_MESSAGE);
}

/** AbortError / TimeoutError from fetch, AbortSignal.timeout or an SDK user abort. */
export function isAbortLike(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError' || name === 'APIUserAbortError';
}

export interface Deadline {
  readonly signal: AbortSignal;
  dispose(): void;
}

/** AbortSignal that fires after `ms`; call `dispose()` when the job ends. */
export function startDeadline(ms: number): Deadline {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(timeoutError()), ms);
  return { signal: controller.signal, dispose: () => clearTimeout(timer) };
}

/**
 * Resolves like `task`, but rejects with a timeout CoachAiError as soon as
 * `signal` aborts (even if `task` ignores the signal and keeps hanging).
 */
export function withDeadline<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    task.catch(() => undefined);
    return Promise.reject(timeoutError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(timeoutError());
    signal.addEventListener('abort', onAbort, { once: true });
    task.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(signal.aborted || isAbortLike(error) ? timeoutError() : error);
      },
    );
  });
}
