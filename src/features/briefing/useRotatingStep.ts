import { useEffect, useState } from 'react';

const STEP_MS = 2400;

/**
 * Index of the progress message to show while `active` (advances every few seconds and
 * stays on the last one). Resets when it stops.
 */
export function useRotatingStep(active: boolean, count: number, stepMs: number = STEP_MS): number {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!active) {
      setIndex(0);
      return undefined;
    }
    const timer = setInterval(() => {
      setIndex((i) => Math.min(i + 1, Math.max(0, count - 1)));
    }, stepMs);
    return () => clearInterval(timer);
  }, [active, count, stepMs]);

  return active ? index : 0;
}
