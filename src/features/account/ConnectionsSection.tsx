import { useIntegrations, useTokens } from '@/data/queries';
import { todayISO } from '@/domain/dates';
import type { Profile } from '@/domain/types';
import { useTrainingCalendar } from '@/integrations/calendar/trainingCalendar';
import { errorMessage } from '@/lib/logger';
import { ErrorNotice, Loading } from '@/ui';

import { watchBrandOf } from '../settings/watchBrand';
import { ConnectionRow } from './ConnectionRow';
import { calendarConnectionView, calendarFeedConnectionView, claudeConnectionView, garminConnectionView } from './connectionsModel';
import { GroupDivider, SettingsGroup } from './SettingsGroup';
import { WatchConnectionRow } from './WatchConnectionRow';

/**
 * Conexiones: your watch connection (Garmin | COROS, the brand is picked inside), the training
 * calendar, Claude and the calendar feed — one row each with its live status.
 */
export function ConnectionsSection({ profile }: { profile: Pick<Profile, 'watchBrand'> }) {
  const integrations = useIntegrations();
  const tokens = useTokens();
  const calendar = useTrainingCalendar();
  const brand = watchBrandOf(profile);
  const garmin = brand === 'garmin' ? garminConnectionView(integrations.data?.find((i) => i.provider === 'garmin_personal'), todayISO()) : null;
  const summary = garmin && (garmin.tone === 'warning' || garmin.tone === 'danger')
    ? `Garmin · ${garmin.status}`
    : 'Reloj, calendario y Claude';

  return (
    <SettingsGroup title="Conexiones" summary={summary} icon="plug">
      {integrations.isLoading ? <Loading label="Comprobando el reloj" /> : integrations.isError && brand === 'garmin' ? (
        <ErrorNotice message={errorMessage(integrations.error)} onRetry={() => void integrations.refetch()} />
      ) : <WatchConnectionRow brand={brand} integrations={integrations.data} />}
      <GroupDivider />
      <ConnectionRow icon="calendarCheck" title="Calendario" view={calendarConnectionView(calendar)} href="/settings/integrations" />
      <GroupDivider />
      {tokens.isLoading ? <Loading label="Comprobando las conexiones" /> : tokens.isError ? (
        <ErrorNotice message={errorMessage(tokens.error)} onRetry={() => void tokens.refetch()} />
      ) : (
        <>
          <ConnectionRow icon="sparkles" title="Claude" view={claudeConnectionView(tokens.data)} href="/settings/claude" />
          <GroupDivider />
          <ConnectionRow icon="link" title="Suscripción de calendario" view={calendarFeedConnectionView(tokens.data)} href="/settings/calendar-feed" />
        </>
      )}
    </SettingsGroup>
  );
}
