import { router } from 'expo-router';
import { Fragment } from 'react';

import { useRaces } from '@/data/queries';
import { todayISO } from '@/domain/dates';
import { raceDistanceLabel, weekdayLabel } from '@/domain/labels';
import type { Profile } from '@/domain/types';
import { Card, Divider, ListRow, type IconName } from '@/ui';

import { nextRace } from '../onboarding/goalModel';
import { formatHours } from '../settings/availabilityModel';

interface MenuItem {
  icon: IconName;
  title: string;
  subtitle: string;
  href: string;
}

function MenuCard({ items }: { items: readonly MenuItem[] }) {
  return (
    <Card padding="md">
      {items.map((item, index) => (
        <Fragment key={item.href}>
          {index > 0 ? <Divider inset={46} /> : null}
          <ListRow icon={item.icon} title={item.title} subtitle={item.subtitle} onPress={() => router.push(item.href)} />
        </Fragment>
      ))}
    </Card>
  );
}

/** Tu objetivo: next race + weekly hours → /races. */
export function GoalSection({ profile }: { profile: Profile }) {
  const races = useRaces();
  const race = nextRace(races.data ?? [], todayISO());
  const hours = `${formatHours(profile.availability.weeklyHoursTarget)}/semana`;
  const distance = race ? raceDistanceLabel(race.distance) : '';
  // Some names already carry the distance ("Triatlón de Valencia · Media distancia").
  const raceText = race ? (race.name.includes(distance) ? race.name : `${race.name} · ${distance}`) : '';
  const subtitle = race ? `${raceText} · ${hours}` : `Sin carrera todavía · ${hours}`;
  return <MenuCard items={[{ icon: 'flag', title: race ? 'Tu carrera' : 'Añade tu carrera', subtitle, href: '/races' }]} />;
}

/** Everything else, one tap away. */
export function MoreSection({ profile }: { profile: Profile }) {
  const { restDay } = profile.availability;
  const items: MenuItem[] = [
    { icon: 'together', title: 'Juntos', subtitle: 'Amigos, quedadas y huecos en común', href: '/together' },
    { icon: 'progress', title: 'Progreso', subtitle: 'Tu carga, tu forma y tus semanas', href: '/progress' },
    {
      icon: 'clock',
      title: 'Disponibilidad',
      subtitle: restDay === null ? 'Tus huecos para entrenar' : `Tus huecos · descanso el ${weekdayLabel(restDay).toLowerCase()}`,
      href: '/settings/availability',
    },
    { icon: 'profile', title: 'Perfil', subtitle: 'Nombre, deportes, umbrales y qué ven tus amigos', href: '/settings/profile' },
    { icon: 'bell', title: 'Avisos', subtitle: 'Antes de cada entreno, check-in y amigos', href: '/settings/notifications' },
    { icon: 'lock', title: 'Privacidad', subtitle: 'Qué datos usamos y quién los ve', href: '/privacy' },
  ];
  return <MenuCard items={items} />;
}
