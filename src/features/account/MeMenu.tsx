import { router } from 'expo-router';
import { Fragment } from 'react';

import { useIntegrations, useRaces } from '@/data/queries';
import { levelLabel, weekdayLabel } from '@/domain/labels';
import type { Profile } from '@/domain/types';
import { Card, Divider, ListRow, SectionHeader, type IconName } from '@/ui';

import { formatHours } from '../settings/availabilityModel';
import { countThresholds } from '../settings/thresholdsModel';

interface MenuItem {
  icon: IconName;
  title: string;
  subtitle: string;
  href: string;
}

function notificationsSummary(profile: Profile): string {
  const p = profile.notificationPrefs;
  const on = [p.workoutReminders, p.morningSummary, p.eveningCheckin, p.weeklyPlanReminder, p.social].filter(Boolean).length;
  return on === 0 ? 'Todo desactivado' : `${on} de 5 avisos activos`;
}

function availabilitySummary(profile: Profile): string {
  const { weeklyHoursTarget, restDay } = profile.availability;
  const rest = restDay === null ? 'sin descanso fijo' : `descanso ${weekdayLabel(restDay).toLowerCase()}`;
  return `${formatHours(weeklyHoursTarget)}/semana · ${rest}`;
}

function MenuGroup({ title, items }: { title: string; items: MenuItem[] }) {
  return (
    <>
      <SectionHeader title={title} />
      <Card padding="md">
        {items.map((item, index) => (
          <Fragment key={item.href}>
            {index > 0 ? <Divider inset={46} /> : null}
            <ListRow icon={item.icon} title={item.title} subtitle={item.subtitle} onPress={() => router.push(item.href)} />
          </Fragment>
        ))}
      </Card>
    </>
  );
}

/** Settings navigation of the Yo tab, grouped by purpose. */
export function MeMenu({ profile }: { profile: Profile }) {
  const integrations = useIntegrations();
  const races = useRaces();
  const garmin = integrations.data?.find((i) => i.provider === 'garmin_personal');
  const garminText = garmin?.state === 'connected' ? 'Garmin conectado' : 'Garmin sin conectar';
  const raceCount = races.data?.length ?? 0;

  const training: MenuItem[] = [
    {
      icon: 'profile',
      title: 'Perfil y umbrales',
      subtitle: `${levelLabel(profile.level)} · ${countThresholds(profile.thresholds)}/5 umbrales`,
      href: '/settings/profile',
    },
    { icon: 'clock', title: 'Disponibilidad', subtitle: availabilitySummary(profile), href: '/settings/availability' },
    {
      icon: 'flag',
      title: 'Carreras',
      subtitle: raceCount === 0 ? 'Añade tu objetivo' : `${raceCount} en el calendario`,
      href: '/races',
    },
    { icon: 'food', title: 'Nutrición', subtitle: 'Registro de comidas y consejos para entrenar', href: '/nutrition' },
  ];
  const connections: MenuItem[] = [
    { icon: 'link', title: 'Conexiones', subtitle: `${garminText} · Salud · Calendario`, href: '/settings/integrations' },
    { icon: 'sparkles', title: 'Conecta tu Claude', subtitle: 'Tu Claude planifica con Garmin y tu semana', href: '/settings/claude' },
    {
      icon: 'calendarBadge',
      title: 'Calendario en tu iPhone',
      subtitle: 'Suscríbete y ve tus entrenos en Calendario',
      href: '/settings/calendar-feed',
    },
  ];
  const app: MenuItem[] = [
    { icon: 'bell', title: 'Notificaciones', subtitle: notificationsSummary(profile), href: '/settings/notifications' },
  ];

  return (
    <>
      <MenuGroup title="Entreno" items={training} />
      <MenuGroup title="Conexiones" items={connections} />
      <MenuGroup title="App" items={app} />
    </>
  );
}
