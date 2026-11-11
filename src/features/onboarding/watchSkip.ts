import { useEffect, useState } from 'react';

import { confirmAction } from '@/features/settings/confirm';

/** The discreet way out of "Tu reloj" (no watch, Garmin down, no iPhone for COROS…). */
export const SKIP_WATCH_LABEL = 'Seguir sin reloj';
export const SKIP_WATCH_HINT = 'Podrás conectarlo después en Tú';

/** Asks before moving on without a watch: the plan and the morning report get more generic. */
export function confirmSkipWatch(): Promise<boolean> {
  return confirmAction({
    title: '¿Seguir sin reloj?',
    message:
      'Sin tu reloj no sé cómo duermes ni lo que entrenas, así que tu plan y tu informe serán más genéricos. Puedes conectarlo cuando quieras en Tú › Conexiones.',
    confirmLabel: SKIP_WATCH_LABEL,
    cancelLabel: 'Volver',
  });
}

/** True once `ms` have passed since mount (the way out appears after a while on the step). */
export function useElapsed(ms: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setElapsed(true), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return elapsed;
}
