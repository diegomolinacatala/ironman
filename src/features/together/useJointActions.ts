import { useState } from 'react';

import type { JointSession } from '@/domain/types';
import { useCancelJointSession, useRespondJointSession } from '@/data/queries';
import { confirmAction } from '@/features/social/confirm';
import { errorMessage, logger } from '@/lib/logger';
import { haptics } from '@/ui';

export type JointAction = 'accept' | 'decline' | 'cancel';

export interface JointActions {
  busy: JointAction | null;
  error: string | null;
  respond: (accept: boolean) => Promise<void>;
  cancel: () => Promise<void>;
}

/** Accept / decline / cancel a quedada with confirmations and Spanish errors. */
export function useJointActions(session: JointSession | null | undefined): JointActions {
  const respondMutation = useRespondJointSession();
  const cancelMutation = useCancelJointSession();
  const [busy, setBusy] = useState<JointAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: JointAction, fn: () => Promise<void>) => {
    setBusy(action);
    setError(null);
    try {
      await fn();
      if (action === 'accept') haptics.success();
    } catch (e) {
      logger.warn(`joint ${action} failed`, e);
      setError(errorMessage(e, 'No se ha podido actualizar la quedada.'));
    } finally {
      setBusy(null);
    }
  };

  const respond = async (accept: boolean) => {
    if (!session) return;
    if (!accept) {
      const ok = await confirmAction({
        title: '¿Rechazar la quedada?',
        message: 'Avisaremos al organizador de que no puedes ir.',
        confirmLabel: 'Rechazar',
        destructive: true,
      });
      if (!ok) return;
    }
    await run(accept ? 'accept' : 'decline', () => respondMutation.mutateAsync({ id: session.id, accept }));
  };

  const cancel = async () => {
    if (!session) return;
    const ok = await confirmAction({
      title: '¿Cancelar la quedada?',
      message: 'Se avisará a los invitados y se quitará el entreno de sus calendarios.',
      confirmLabel: 'Cancelar quedada',
      cancelLabel: 'Volver',
      destructive: true,
    });
    if (!ok) return;
    await run('cancel', () => cancelMutation.mutateAsync(session.id));
  };

  return { busy, error, respond, cancel };
}
