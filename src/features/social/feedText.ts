/**
 * Turns a feed item (typed payload stored as JSON) into Spanish copy:
 * "Álex completó Rodaje Z2" + "1h 10' · 12,5 km".
 */
import { formatDayLabel, formatDistance, formatDuration } from '@/domain/dates';
import { raceDistanceLabel, sportLabel } from '@/domain/labels';
import { RACE_DISTANCES, SPORTS, type FeedItem, type ISODate, type RaceDistance, type Sport, type UUID } from '@/domain/types';

export interface FeedText {
  /** "Álex" or "Tú". */
  actor: string;
  /** Rest of the sentence, e.g. "completó Rodaje Z2". */
  action: string;
  /** Secondary line, e.g. "1h 10' · 12,5 km". */
  detail: string | null;
  sport: Sport | null;
}

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function readSport(payload: Record<string, unknown>): Sport | null {
  const value = payload.sport;
  return typeof value === 'string' && (SPORTS as readonly string[]).includes(value) ? (value as Sport) : null;
}

function readRaceDistance(payload: Record<string, unknown>): RaceDistance | null {
  const value = payload.distance;
  return typeof value === 'string' && (RACE_DISTANCES as readonly string[]).includes(value)
    ? (value as RaceDistance)
    : null;
}

function readDate(payload: Record<string, unknown>): ISODate | null {
  const value = readString(payload, 'date');
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function joinDetail(parts: readonly (string | null)[]): string | null {
  const present = parts.filter((p): p is string => Boolean(p));
  return present.length > 0 ? present.join(' · ') : null;
}

function workoutCompleted(payload: Record<string, unknown>, isMe: boolean): Omit<FeedText, 'actor'> {
  const sport = readSport(payload);
  const title = readString(payload, 'title');
  const verb = isMe ? 'completaste' : 'completó';
  const what = title ?? (sport && sport !== 'rest' ? `un entreno de ${sportLabel(sport).toLowerCase()}` : 'un entreno');
  const duration = readNumber(payload, 'durationMin');
  const distance = readNumber(payload, 'distanceM');
  return {
    action: `${verb} ${what}`,
    detail: joinDetail([
      duration ? formatDuration(duration) : null,
      distance && sport ? formatDistance(distance, sport) : null,
    ]),
    sport,
  };
}

function raceAdded(payload: Record<string, unknown>, isMe: boolean, today: ISODate): Omit<FeedText, 'actor'> {
  const name = readString(payload, 'name');
  const date = readDate(payload);
  const distance = readRaceDistance(payload);
  const verb = isMe ? 'añadiste' : 'añadió';
  return {
    action: name ? `${verb} una carrera: ${name}` : `${verb} una carrera`,
    detail: joinDetail([distance ? raceDistanceLabel(distance) : null, date ? formatDayLabel(date, today) : null]),
    sport: null,
  };
}

function jointConfirmed(payload: Record<string, unknown>, isMe: boolean, today: ISODate): Omit<FeedText, 'actor'> {
  const title = readString(payload, 'title');
  const date = readDate(payload);
  const verb = isMe ? 'confirmaste' : 'confirmó';
  return {
    action: title ? `${verb} la quedada «${title}»` : `${verb} una quedada`,
    detail: date ? formatDayLabel(date, today) : null,
    sport: readSport(payload),
  };
}

function readNames(payload: Record<string, unknown>): string[] {
  const value = payload.participants;
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0) : [];
}

/** "David", "David y Marta", "David, Marta y Luis". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

/** "Entrenasteis juntos": the actor (organizer) trained with the other participants. */
function jointCompleted(
  payload: Record<string, unknown>,
  isMe: boolean,
  actorName: string,
  myName: string | null,
): Omit<FeedText, 'actor'> {
  const title = readString(payload, 'title');
  const others = readNames(payload)
    .filter((n) => n !== actorName)
    .map((n) => (!isMe && myName !== null && n === myName ? 'contigo' : n));
  const hidden = typeof payload.othersCount === 'number' && payload.othersCount > 0 ? payload.othersCount : 0;
  const withMe = others.includes('contigo');
  const rest = others.filter((n) => n !== 'contigo');
  const people = hidden > 0 ? [...rest, hidden === 1 ? 'otra persona' : `${hidden} personas más`] : rest;
  const verb = isMe ? 'entrenaste' : 'entrenó';
  const withOthers = people.length > 0 ? `con ${joinNames(people)}` : '';
  const withWho = withMe
    ? withOthers ? ` contigo y ${withOthers}` : ' contigo'
    : withOthers ? ` ${withOthers}` : ' en compañía';
  const duration = readNumber(payload, 'durationMin');
  return {
    action: `${verb}${withWho}${title ? `: ${title}` : ''}`,
    detail: joinDetail(['Entrenasteis juntos', duration ? formatDuration(duration) : null]),
    sport: readSport(payload),
  };
}

export function describeFeedItem(item: FeedItem, myId: UUID | null, today: ISODate, myName: string | null = null): FeedText {
  const isMe = myId !== null && item.actor.id === myId;
  const actor = isMe ? 'Tú' : item.actor.displayName || `@${item.actor.username}`;
  const payload = item.payload ?? {};
  switch (item.type) {
    case 'workout_completed':
      return { actor, ...workoutCompleted(payload, isMe) };
    case 'race_added':
      return { actor, ...raceAdded(payload, isMe, today) };
    case 'joint_confirmed':
      return { actor, ...jointConfirmed(payload, isMe, today) };
    case 'joint_completed':
      return { actor, ...jointCompleted(payload, isMe, item.actor.displayName, myName) };
    case 'plan_updated':
      return {
        actor,
        action: isMe ? 'actualizaste tu plan de la semana' : 'actualizó su plan de la semana',
        detail: null,
        sport: null,
      };
    default:
      return { actor, action: 'tiene novedades', detail: null, sport: null };
  }
}
