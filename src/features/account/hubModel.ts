/**
 * Tú (settings hub): row titles and subtitles derived from the profile and races (pure).
 */
import { levelLabel, raceDistanceLabel, sportLabel, weekdayLabel } from '@/domain/labels';
import type { Availability, ISODate, Profile, Race } from '@/domain/types';

import { nextRace } from '../onboarding/goalModel';
import { formatHours } from '../settings/availabilityModel';
import { raceCountdown } from './connectionsModel';

export interface RowText {
  title: string;
  subtitle: string;
}

/** "Tu carrera · Valencia · Olímpica · faltan 128 días", or the nudge to add one. */
export function raceRow(races: readonly Race[] | undefined, today: ISODate): RowText {
  const race = nextRace(races ?? [], today);
  const countdown = raceCountdown(races, today);
  if (!race || !countdown) return { title: 'Añade tu carrera', subtitle: 'El plan se construye hacia ella' };
  const distance = raceDistanceLabel(race.distance);
  // Some names already carry the distance ("Triatlón de Valencia · Media distancia").
  const name = race.name.includes(distance) ? race.name : `${race.name} · ${distance}`;
  const when = countdown.days === 0 ? 'es hoy' : `faltan ${countdown.value}`;
  return { title: 'Tu carrera', subtitle: `${name} · ${when}` };
}

/** "9 h/semana · descanso el domingo". */
export function availabilitySubtitle(availability: Availability): string {
  const hours = `${formatHours(availability.weeklyHoursTarget)}/semana`;
  return availability.restDay === null ? `${hours} · sin día fijo de descanso` : `${hours} · descanso el ${weekdayLabel(availability.restDay).toLowerCase()}`;
}

/** "Natación, Bici, Carrera · Intermedio". */
export function sportsProfileSubtitle(profile: Pick<Profile, 'sports' | 'level'>): string {
  const sports = profile.sports.map(sportLabel).join(', ');
  return sports ? `${sports} · ${levelLabel(profile.level)}` : levelLabel(profile.level);
}
