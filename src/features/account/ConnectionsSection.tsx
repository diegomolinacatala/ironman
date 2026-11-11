import { useIntegrations, useTokens } from '@/data/queries';
import type { Profile } from '@/domain/types';
import { useTrainingCalendar } from '@/integrations/calendar/trainingCalendar';
import { errorMessage } from '@/lib/logger';
import { Loading } from '@/ui';

import { useWatchBrand } from '../settings/useWatchBrand';
import { WatchBrandPicker } from '../settings/WatchBrandPicker';
import { ConnectionFeedback, ConnectionRow } from './ConnectionRow';
import { calendarConnectionView, calendarFeedConnectionView, claudeConnectionView } from './connectionsModel';
import { GroupDivider, SettingsGroup } from './SettingsGroup';
import { WatchConnectionRow } from './WatchConnectionRow';

/**
 * Conexiones: your watch (Garmin | COROS) and its connection, the training calendar,
 * Claude and the calendar feed — live status and the one-tap fix.
 */
export function ConnectionsSection({ profile }: { profile: Pick<Profile, 'watchBrand'> }) {
  const integrations = useIntegrations();
  const tokens = useTokens();
  const calendar = useTrainingCalendar();
  const watch = useWatchBrand(profile);

  if (integrations.isLoading || tokens.isLoading) {
    return (
      <SettingsGroup title="Conexiones">
        <Loading label="Comprobando tus conexiones" />
      </SettingsGroup>
    );
  }

  return (
    <SettingsGroup title="Conexiones">
      <WatchBrandPicker choice={watch} />
      <GroupDivider />
      <WatchConnectionRow brand={watch.brand} integrations={integrations.data} />
      <GroupDivider />
      <ConnectionRow icon="calendarCheck" title="Calendario" view={calendarConnectionView(calendar)} href="/settings/integrations" />
      <GroupDivider />
      <ConnectionRow icon="sparkles" title="Claude" view={claudeConnectionView(tokens.data)} href="/settings/claude" />
      <GroupDivider />
      <ConnectionRow icon="link" title="Suscripción de calendario" view={calendarFeedConnectionView(tokens.data)} href="/settings/calendar-feed" />
      <ConnectionFeedback
        message={null}
        error={null}
        loadError={integrations.isError ? errorMessage(integrations.error) : null}
        onRetry={() => void integrations.refetch()}
      />
    </SettingsGroup>
  );
}
