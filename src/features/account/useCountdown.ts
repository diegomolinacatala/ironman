import { useCallback, useEffect, useState } from 'react';

const TICK_MS = 1000;

export interface Countdown {
  secondsLeft: number;
  restart: () => void;
}

/** Seconds countdown (e.g. resend cooldown). Starts running on mount. */
export function useCountdown(seconds: number): Countdown {
  const [deadline, setDeadline] = useState(() => Date.now() + seconds * 1000);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (now >= deadline) return undefined;
    const handle = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(handle);
  }, [deadline, now >= deadline]); // eslint-disable-line react-hooks/exhaustive-deps

  const restart = useCallback(() => {
    const start = Date.now();
    setNow(start);
    setDeadline(start + seconds * 1000);
  }, [seconds]);

  return { secondsLeft: Math.max(0, Math.ceil((deadline - now) / 1000)), restart };
}
