/**
 * Approximate periodization (docs/research/02 §5), counted back from the next
 * A race (or next race of any priority). Used only to give Claude context; the
 * app's rules engine has the authoritative version.
 */
import { addDays, diffDays, startOfWeek } from '../dates.ts';
import type { ISODate, Race, RaceDistance } from '../types.ts';

export type Phase = 'prep' | 'base' | 'build' | 'peak' | 'taper' | 'race_week' | 'recovery' | 'transition';

const PHASE_LABELS: Record<Phase, string> = {
  prep: 'Preparación',
  base: 'Base',
  build: 'Construcción',
  peak: 'Pico',
  taper: 'Afinamiento (taper)',
  race_week: 'Semana de carrera',
  recovery: 'Recuperación post-carrera',
  transition: 'Transición',
};

const FOCUS: Record<Phase, string> = {
  prep: 'Volver a la rutina: Z1-Z2, técnica y fuerza general.',
  base: 'Motor aeróbico: mucho Z2, técnica, fuerza; poca intensidad (≥80 % suave).',
  build: 'Especificidad: intervalos a ritmo de carrera, transiciones (brick) y tiradas largas.',
  peak: 'Mantener intensidad con menos volumen; simulaciones cortas de carrera.',
  taper: 'Bajar volumen 40-60 % manteniendo intensidad y frecuencia para llegar fresco.',
  race_week: 'Activaciones cortas, descanso, nada nuevo. Sin pádel/fútbol los 7 días previos.',
  recovery: 'Recuperar tras la carrera: suave, sin intensidad unos días.',
  transition: 'Descanso activo, otros deportes, sin estructura.',
};

const TAPER_WEEKS: Record<RaceDistance, number> = {
  sprint: 1,
  olympic: 1,
  half: 2,
  full: 3,
  run_5k: 1,
  run_10k: 1,
  run_half: 2,
  run_marathon: 3,
  other: 1,
};

const BUILD_WEEKS: Record<RaceDistance, number> = {
  sprint: 6,
  olympic: 8,
  half: 10,
  full: 12,
  run_5k: 5,
  run_10k: 6,
  run_half: 8,
  run_marathon: 10,
  other: 8,
};

export interface PhaseInfo {
  phase: Phase;
  label: string;
  focus: string;
  targetRace: Pick<Race, 'id' | 'name' | 'date' | 'distance' | 'priority'> | null;
  daysToRace: number | null;
  weeksToRace: number | null;
  /** 3:1 heuristic: every 4th week of base/build is lighter. */
  suggestRecoveryWeek: boolean;
}

export function nextRace(races: readonly Race[], today: ISODate): Race | null {
  const upcoming = [...races].filter((r) => r.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  return upcoming.find((r) => r.priority === 'A') ?? upcoming[0] ?? null;
}

function info(phase: Phase, race: Race | null, days: number | null, weeks: number | null, recovery = false): PhaseInfo {
  return {
    phase,
    label: PHASE_LABELS[phase],
    focus: FOCUS[phase],
    targetRace: race ? { id: race.id, name: race.name, date: race.date, distance: race.distance, priority: race.priority } : null,
    daysToRace: days,
    weeksToRace: weeks,
    suggestRecoveryWeek: recovery,
  };
}

export function phaseFor(weekStart: ISODate, races: readonly Race[]): PhaseInfo {
  const monday = startOfWeek(weekStart);
  const recent = races.find((r) => {
    const since = diffDays(monday, r.date);
    return since > 0 && since <= 7 && r.priority !== 'C';
  });
  const race = nextRace(races, monday);
  if (!race) {
    const lastRace = [...races].filter((r) => r.date < monday).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (recent) return info('recovery', null, null, null);
    if (lastRace && diffDays(monday, lastRace.date) <= 21) return info('transition', null, null, null);
    return info('base', null, null, null);
  }
  const days = diffDays(race.date, monday);
  const weeks = Math.round(diffDays(startOfWeek(race.date), monday) / 7);
  if (recent && weeks > TAPER_WEEKS[race.distance]) return info('recovery', race, days, weeks);
  if (race.date <= addDays(monday, 6)) return info('race_week', race, days, weeks);
  const taper = TAPER_WEEKS[race.distance];
  if (weeks <= taper) return info(weeks === taper && taper > 1 ? 'peak' : 'taper', race, days, weeks);
  const build = BUILD_WEEKS[race.distance];
  const weeksBeforeTaper = weeks - taper;
  const recovery = weeksBeforeTaper % 4 === 0;
  if (weeksBeforeTaper <= build) return info('build', race, days, weeks, recovery);
  if (weeksBeforeTaper > build + 20) return info('prep', race, days, weeks);
  return info('base', race, days, weeks, recovery);
}
