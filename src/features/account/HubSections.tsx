import { todayISO } from '@/domain/dates';
import { useRepository } from '@/data/context';
import type { Profile, Race } from '@/domain/types';
import { coachVoiceName, useCoachVoice } from '@/integrations/speech/coachVoice';

import { AppearancePicker } from '../settings/AppearancePicker';
import { availabilitySubtitle, raceRow, sportsProfileSubtitle } from './hubModel';
import { GroupDivider, LinkRows, SettingsGroup } from './SettingsGroup';

/** Entrenamiento: your race, your week and your sport profile. */
export function TrainingGroup({ profile, races }: { profile: Profile; races: readonly Race[] | undefined }) {
  const race = raceRow(races, todayISO());
  return (
    <SettingsGroup title="Entrenamiento">
      <LinkRows
        items={[
          { icon: 'flag', title: race.title, subtitle: race.subtitle, href: '/races', brand: true },
          { icon: 'clock', title: 'Disponibilidad', subtitle: availabilitySubtitle(profile.availability), href: '/settings/availability' },
          { icon: 'profile', title: 'Perfil deportivo', subtitle: sportsProfileSubtitle(profile), href: '/settings/profile' },
        ]}
      />
    </SettingsGroup>
  );
}

/** Preferencias: light / dark / automatic and the notification settings. */
export function PreferencesGroup() {
  return (
    <SettingsGroup title="Preferencias">
      <AppearancePicker />
      <GroupDivider />
      <LinkRows
        items={[
          {
            icon: 'bell',
            title: 'Notificaciones',
            subtitle: 'Antes de cada entreno, check-in y amigos',
            href: '/settings/notifications',
          },
        ]}
      />
    </SettingsGroup>
  );
}

/** Privacidad: what we use, who sees it (and the Coach IA permission). */
export function PrivacyGroup() {
  return (
    <SettingsGroup title="Privacidad">
      <LinkRows items={[{ icon: 'lock', title: 'Privacidad y datos', subtitle: 'Qué datos usamos, para qué y quién los ve', href: '/privacy' }]} />
    </SettingsGroup>
  );
}

/** Tu coach → Voz: which voice reads the briefing and the coach's replies. */
export function CoachVoiceRow() {
  const chosen = useCoachVoice();
  // Demo mode / AI off: the iPhone voice is what will actually play.
  const voice = useRepository().synthesizeSpeech ? chosen : 'device';
  return (
    <LinkRows
      items={[{ icon: 'speaker', title: 'Voz del coach', subtitle: coachVoiceName(voice), href: '/settings/voice', brand: true }]}
    />
  );
}
