/**
 * Spanish copy for the weekly planner: one-sentence reason per change and a
 * short summary of the week.
 */
import { formatDuration, weekdayOf } from './dates';
import { phaseLabel, raceDistanceLabel, weekdayLabel } from './labels';
import type { PhaseInfo } from './periodization';
import type { Dropped, Placed } from './placement';
import { buildSession, specClass, specSport, type SessionSpec } from './sessions';
import type { Sport, Weekday } from './types';

export function reasonFor(spec: SessionSpec, info: PhaseInfo, shortened: boolean, runCapped: boolean): string {
  const tail = shortened ? ' (acortada para que encaje en tu semana)' : '';
  const cls = specClass(spec);
  const sport = specSport(spec);
  let base: string;
  switch (spec.code) {
    case 'RACE':
      base = `Día de carrera: ${spec.raceName ?? 'tu carrera'}`;
      break;
    case 'ACTIVATION':
      base = 'Activación corta el día antes de la carrera para llegar con chispa';
      break;
    case 'BRICK':
      base = 'Brick para acostumbrar las piernas a correr después de la bici';
      break;
    case 'BK_LONG':
      base = 'Bici larga en tu día largo para construir resistencia aeróbica';
      break;
    case 'RN_LONG':
      base = runCapped
        ? 'Tirada larga semanal sin superar en más de un 10 % la más larga del último mes'
        : 'Tirada larga semanal a ritmo cómodo';
      break;
    case 'SW_TECH':
      base = 'Técnica de natación: la eficiencia se pierde rápido si no se practica';
      break;
    case 'SW_CSS':
    case 'SW_SPEED':
      base = 'Series de natación para mejorar tu ritmo en el agua';
      break;
    case 'ST_HEAVY':
    case 'ST_MAINT':
      base = 'Fuerza para mejorar la economía y prevenir lesiones';
      break;
    case 'MOB':
      base = 'Movilidad para recuperar mejor';
      break;
    default:
      base =
        cls === 'QUALITY'
          ? `Sesión de calidad de ${sport === 'bike' ? 'bici' : 'carrera'} (${phaseLabel(info.phase).toLowerCase()}), sin días duros al lado`
          : 'Fondo aeróbico suave para sumar volumen sin acumular fatiga';
  }
  return `${base}${tail}.`;
}

const SPORT_NAMES: Partial<Record<Sport, [string, string]>> = {
  swim: ['natación', 'natación'],
  bike: ['bici', 'bici'],
  run: ['carrera', 'carrera'],
  brick: ['brick', 'bricks'],
  strength: ['fuerza', 'fuerza'],
  mobility: ['movilidad', 'movilidad'],
};

function countsText(placed: readonly Placed[]): string {
  const counts = new Map<Sport, number>();
  for (const p of placed) {
    if (specClass(p.spec) === 'RACE') continue;
    const sport = specSport(p.spec);
    counts.set(sport, (counts.get(sport) ?? 0) + 1);
  }
  const order: Sport[] = ['swim', 'bike', 'brick', 'run', 'strength', 'mobility'];
  const parts = order
    .filter((s) => (counts.get(s) ?? 0) > 0)
    .map((s) => {
      const n = counts.get(s) ?? 0;
      const names = SPORT_NAMES[s] ?? [s, s];
      return `${n} de ${n === 1 ? names[0] : names[1]}`;
    });
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;
}

function dayName(date: string): string {
  return weekdayLabel(weekdayOf(date)).toLowerCase();
}

export interface SummaryInput {
  info: PhaseInfo;
  placed: readonly Placed[];
  dropped: readonly Dropped[];
  restDay: Weekday | null;
  /** The usual rest day falls on a race this week, so the rest moved to `restDay`. */
  restMovedForRace?: boolean;
  /** L05 easy day (≤ 60') when there is no full rest day. */
  easyDay?: Weekday | null;
  existingCount: number;
  warnings: readonly string[];
  notes: readonly string[];
}

function restSentence(input: SummaryInput): string | null {
  if (input.restDay !== null) {
    const day = weekdayLabel(input.restDay);
    return input.restMovedForRace ? `${day} de descanso: lo cambio de día porque te toca competir.` : `${day} de descanso.`;
  }
  if (input.easyDay !== null && input.easyDay !== undefined) return `${weekdayLabel(input.easyDay)} suave: como mucho 60' tranquilos para recuperar.`;
  return null;
}

export function summaryFor(input: SummaryInput): string {
  const { info, placed } = input;
  const race = info.targetRace;
  const phase = `${phaseLabel(info.phase)}${info.isRecoveryWeek ? ' (descarga)' : ''}`;
  const weeks = info.weeksToRace === 1 ? 'falta 1 semana' : `faltan ${info.weeksToRace ?? 0} semanas`;
  const header = !race || info.weeksToRace === null
    ? `${phase}.`
    : info.weeksToRace === 0
      ? `${race.name} (${raceDistanceLabel(race.distance)}) es esta semana.`
      : `${phase}: ${weeks} para ${race.name} (${raceDistanceLabel(race.distance)}).`;
  const sentences = [header, info.focus];
  const sessions = placed.filter((p) => specClass(p.spec) !== 'RACE');
  if (sessions.length > 0) {
    const minutes = sessions.reduce((s, p) => s + p.spec.durationMin, 0);
    sentences.push(`Te propongo ${formatDuration(minutes)} en ${sessions.length} sesiones: ${countsText(sessions)}.`);
  } else {
    sentences.push(input.dropped.length === 0 ? 'No hace falta añadir nada más a esta semana.' : 'No he encontrado hueco libre para añadir sesiones esta semana.');
  }
  if (input.existingCount > 0) sentences.push(`Respeto tus ${input.existingCount} entrenos ya puestos y tus quedadas.`);
  const longs = sessions.filter((p) => !p.spec.allowedDates && (p.spec.code === 'BK_LONG' || p.spec.code === 'BRICK' || p.spec.code === 'RN_LONG'));
  if (longs.length > 0) {
    const names: Record<string, string> = { BK_LONG: 'bici larga', BRICK: 'brick', RN_LONG: 'tirada larga' };
    const text = longs.map((p) => `${names[p.spec.code] ?? 'larga'} el ${dayName(p.date)}`).join(' y ');
    sentences.push(`Largas: ${text}.`);
  }
  const rest = restSentence(input);
  if (rest) sentences.push(rest);
  if (input.dropped.length > 0) {
    const titles = input.dropped.map((d) => buildSession(d.spec).title).slice(0, 3).join(', ');
    sentences.push(`No he encontrado hueco para: ${titles}.`);
  }
  return [...sentences, ...input.notes, ...input.warnings].join(' ');
}
