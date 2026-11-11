import { useState } from 'react';

import { useSyncGarmin } from '@/data/queries';
import { todayISO } from '@/domain/dates';
import type { IntegrationStatus, WatchBrand } from '@/domain/types';
import { FIRST_HEALTH_IMPORT_DAYS, useHealthIntegration } from '@/integrations/hooks';
import { errorMessage, logger } from '@/lib/logger';
import { haptics } from '@/ui';

import { corosImportView } from '../settings/corosModel';
import { ConnectionFeedback, ConnectionRow } from './ConnectionRow';
import { corosConnectionView, garminConnectionView } from './connectionsModel';

const INTEGRATIONS_ROUTE = '/settings/integrations';

export interface WatchConnectionRowProps {
  brand: WatchBrand;
  integrations: readonly IntegrationStatus[] | undefined;
}

/** Your watch in Tú › Conexiones: Garmin (synced by the server) or COROS (Apple Salud on this iPhone). */
export function WatchConnectionRow({ brand, integrations }: WatchConnectionRowProps) {
  return brand === 'coros' ? <CorosRow /> : <GarminRow integrations={integrations} />;
}

interface Feedback {
  message: string | null;
  note: string | null;
  error: string | null;
}

const NO_FEEDBACK: Feedback = { message: null, note: null, error: null };

function GarminRow({ integrations }: { integrations: readonly IntegrationStatus[] | undefined }) {
  const sync = useSyncGarmin();
  const [feedback, setFeedback] = useState<Feedback>(NO_FEEDBACK);
  const view = garminConnectionView(integrations?.find((i) => i.provider === 'garmin_personal'), todayISO());

  const onSync = async () => {
    setFeedback(NO_FEEDBACK);
    try {
      await sync.mutateAsync();
      haptics.success();
      setFeedback({ ...NO_FEEDBACK, message: 'Garmin sincronizado.' });
    } catch (err) {
      logger.warn('tú: garmin sync failed', err);
      haptics.warning();
      setFeedback({ ...NO_FEEDBACK, error: errorMessage(err, 'No se pudo sincronizar con Garmin.') });
    }
  };

  return (
    <>
      <ConnectionRow icon="watch" title="Garmin" view={view} href={INTEGRATIONS_ROUTE} busy={sync.isPending} onSync={() => void onSync()} />
      <ConnectionFeedback {...feedback} />
    </>
  );
}

function CorosRow() {
  const health = useHealthIntegration();
  const [feedback, setFeedback] = useState<Feedback>(NO_FEEDBACK);

  const onSync = async () => {
    setFeedback(NO_FEEDBACK);
    try {
      const result = await health.syncNow({ days: FIRST_HEALTH_IMPORT_DAYS });
      haptics.success();
      const seen = corosImportView(result, health.sources).kind === 'seen';
      setFeedback(
        seen
          ? { ...NO_FEEDBACK, message: 'COROS sincronizado.' }
          : { ...NO_FEEDBACK, note: 'Aún no vemos datos de COROS: abre la app COROS con el reloj cerca y vuelve a probar.' },
      );
    } catch (err) {
      logger.warn('tú: coros sync failed', err);
      haptics.warning();
      setFeedback({ ...NO_FEEDBACK, error: errorMessage(err, 'No se pudo leer Apple Salud.') });
    }
  };

  return (
    <>
      <ConnectionRow
        icon="watch"
        title="COROS"
        view={corosConnectionView(health)}
        href={INTEGRATIONS_ROUTE}
        busy={health.busy}
        onSync={() => void onSync()}
      />
      <ConnectionFeedback {...feedback} />
    </>
  );
}
