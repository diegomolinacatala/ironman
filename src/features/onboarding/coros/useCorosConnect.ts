import { useCallback, useEffect, useRef, useState } from 'react';

import { corosStepPhase, isCorosStepDone, type CorosStepPhase } from '@/features/settings/corosModel';
import { FIRST_HEALTH_IMPORT_DAYS, useHealthIntegration, type HealthSyncResult } from '@/integrations/hooks';
import { errorMessage, logger } from '@/lib/logger';
import { haptics } from '@/ui';

/** Connected, but the first read of Apple Salud failed (offline…): the data still arrives later. */
const READ_FAILED = 'Apple Salud está conectado, pero no hemos podido leerlo. Comprueba otra vez en un momento.';

export interface CorosConnect {
  phase: CorosStepPhase;
  /** Apple Salud is on (or simulated in the demo): "Continuar". */
  done: boolean;
  /** What the last read brought (null before the first one, or when it failed). */
  result: HealthSyncResult | null;
  /** Apps seen writing to Apple Salud in earlier syncs on this device. */
  known: readonly string[];
  error: string | null;
  /** A connect or a read failed: the onboarding offers "Seguir sin reloj". */
  failed: boolean;
  /** «Conectar Apple Salud»: permission sheet + first import (4 weeks); simulated in the web demo. */
  connect: () => Promise<void>;
  /** «Comprobar otra vez»: reads Apple Salud again (4 weeks). */
  check: () => Promise<void>;
}

interface ReadState {
  result: HealthSyncResult | null;
  /** A read finished in this visit (even if it failed and left no result). */
  attempted: boolean;
  working: boolean;
  error: string | null;
  failed: boolean;
}

const IDLE: ReadState = { result: null, attempted: false, working: false, error: null, failed: false };

type ReadTask = () => Promise<HealthSyncResult | null>;

/** One read of Apple Salud at a time, keeping what it brought (null = the read failed). */
function useHealthRead(): ReadState & { read: (task: ReadTask, fallback: string) => Promise<void> } {
  const [state, setState] = useState<ReadState>(IDLE);
  const read = useCallback(async (task: ReadTask, fallback: string) => {
    setState((prev) => ({ ...prev, working: true, error: null }));
    try {
      const result = await task();
      if (result) haptics.success();
      setState((prev) => ({ ...prev, result, attempted: true, working: false, error: result ? null : READ_FAILED, failed: prev.failed || !result }));
    } catch (err) {
      logger.warn('onboarding: coros health read failed', err);
      haptics.warning();
      setState((prev) => ({ ...prev, attempted: true, working: false, error: errorMessage(err, fallback), failed: true }));
    }
  }, []);
  return { ...state, read };
}

/** "Tu reloj" › COROS: COROS writes to Apple Salud and we read it on this iPhone. */
export function useCorosConnect({ isDemo }: { isDemo: boolean }): CorosConnect {
  const health = useHealthIntegration();
  const { read, ...last } = useHealthRead();
  const [simulated, setSimulated] = useState(false);
  const autoChecked = useRef(false);
  const simulate = isDemo && !health.available;
  const { connect: connectHealth, syncNow } = health;

  const connect = useCallback(async () => {
    if (!simulate) return read(() => connectHealth({ days: FIRST_HEALTH_IMPORT_DAYS }), 'No se pudo conectar con Apple Salud.');
    haptics.success();
    setSimulated(true);
  }, [simulate, read, connectHealth]);

  const check = useCallback(() => read(() => syncNow({ days: FIRST_HEALTH_IMPORT_DAYS }), 'No se pudo leer Apple Salud.'), [read, syncNow]);

  // Apple Salud already on (back on this step, or a restart): show what it holds right away.
  const needsFirstRead = health.loaded && health.enabled && !last.attempted && !last.working && !simulate;
  useEffect(() => {
    if (!needsFirstRead || autoChecked.current) return;
    autoChecked.current = true;
    void check();
  }, [needsFirstRead, check]);

  const { available, loaded, enabled, sources } = health;
  const phase = corosStepPhase({ available, isDemo, loaded, enabled, simulated, known: sources, ...last });
  return { phase, done: isCorosStepDone(phase), result: last.result, known: sources, error: last.error, failed: last.failed, connect, check };
}
