import { todayISO } from '@/domain/dates';
import { useRepository } from '@/data/context';
import { placesSubtitle } from '@/domain/places';
import type { Profile, Race } from '@/domain/types';
import { coachVoiceName, useCoachVoice } from '@/integrations/speech/coachVoice';

import { AppearancePicker } from '../settings/AppearancePicker';
import { placeRowSubtitle } from '../weather/weatherModel';
import { trainingPrefsSubtitle } from '../settings/trainingPrefsModel';
import { contextSubtitle } from '../context/interviewModel';
import { availabilitySubtitle, raceRow, sportsProfileSubtitle } from './hubModel';
import { MyWhooshRow } from './MyWhooshRow';
import { GroupDivider, LinkRows, SettingsGroup } from './SettingsGroup';

/** Entrenamiento: your race, your week, how you like to train, your sport profile, MyWhoosh indoors and your city for the weather. */
export function TrainingGroup({ profile, races }: { profile: Profile; races: readonly Race[] | undefined }) {
  const race = raceRow(races, todayISO());
  return (
    <SettingsGroup title="Entrenamiento" icon="flag" summary="Carreras, horarios, perfil e importar un plan">
      <LinkRows
        items={[
          { icon: 'flag', title: race.title, subtitle: race.subtitle, href: '/races', brand: true },
          { icon: 'clock', title: 'Tus horarios', subtitle: availabilitySubtitle(profile.availability), href: '/settings/availability' },
          { icon: 'target', title: 'Tu forma de entrenar', subtitle: trainingPrefsSubtitle(profile.trainingPrefs), href: '/settings/training' },
          { icon: 'coach', title: 'Tu contexto', subtitle: contextSubtitle(profile.athleteContext, profile.sports), href: '/settings/context' },
          { icon: 'profile', title: 'Perfil deportivo', subtitle: sportsProfileSubtitle(profile), href: '/settings/profile' },
          { icon: 'location', title: 'Mis sitios', subtitle: placesSubtitle(profile.places), href: '/settings/places' },
          { icon: 'cloudSun', title: 'Tu ciudad para el tiempo', subtitle: placeRowSubtitle(profile.weatherPlace), href: '/settings/weather' },
          { icon: 'clipboard', title: 'Importar un plan', subtitle: 'El de tu entrenador: foto, PDF, Excel o TrainingPeaks', href: '/plan-import' },
        ]}
      />
      <GroupDivider />
      <MyWhooshRow />
    </SettingsGroup>
  );
}

/** Preferencias: light / dark / automatic, notifications and privacy (one group, not three). */
export function PreferencesGroup() {
  return (
    <SettingsGroup title="Preferencias" icon="settings" summary="Apariencia, notificaciones y privacidad">
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
          { icon: 'lock', title: 'Privacidad y datos', subtitle: 'Qué datos usamos, para qué y quién los ve', href: '/privacy' },
        ]}
      />
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
