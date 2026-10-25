/**
 * Runs async OS jobs one at a time, in call order, and tells each job whether a
 * newer one was queued meanwhile so it can stop early (pure, unit-tested).
 *
 * Local notifications use it so a sign-out cancel can never be overtaken by an
 * older reschedule that was still awaiting the OS: the cancel waits for it and
 * then wipes whatever it scheduled, and a superseded reschedule schedules nothing.
 */
export interface SerialQueue {
  /** Queues `job`. `isCurrent()` turns false as soon as a newer job is queued. */
  run<T>(job: (isCurrent: () => boolean) => Promise<T>): Promise<T>;
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  let generation = 0;
  return {
    run<T>(job: (isCurrent: () => boolean) => Promise<T>): Promise<T> {
      generation += 1;
      const mine = generation;
      const isCurrent = () => mine === generation;
      const next = tail.then(() => job(isCurrent));
      // A failed job must not block the ones queued after it.
      tail = next.catch(() => undefined);
      return next;
    },
  };
}
