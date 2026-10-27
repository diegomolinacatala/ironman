import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

/**
 * Calls `task` every `intervalMs` while `enabled` and the app is in the
 * foreground (paused in background, resumed with an immediate call).
 */
export function usePolling(task: () => void, intervalMs: number, enabled: boolean): void {
  const taskRef = useRef(task);
  taskRef.current = task;

  useEffect(() => {
    if (!enabled) return undefined;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => taskRef.current(), intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState !== 'background') start();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        taskRef.current();
        start();
      } else if (state === 'background') {
        stop();
      }
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [enabled, intervalMs]);
}
