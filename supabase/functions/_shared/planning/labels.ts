/** Spanish labels used in generated text (context for Claude, ICS, notifications). */
import type { Intensity, LifeEventKind, RaceDistance, Sport } from '../types.ts';

const SPORT_LABELS: Record<Sport, string> = {
  swim: 'Natación',
  bike: 'Bici',
  run: 'Carrera',
  brick: 'Transición (bici + carrera)',
  strength: 'Fuerza',
  mobility: 'Movilidad',
  other: 'Otro deporte',
  rest: 'Descanso',
};

const INTENSITY_LABELS: Record<Intensity, string> = {
  recovery: 'Recuperación (Z1)',
  endurance: 'Fondo (Z2)',
  tempo: 'Tempo (Z3)',
  threshold: 'Umbral (Z4)',
  vo2: 'VO2 (Z5)',
  race: 'Ritmo carrera',
};

const LIFE_EVENT_LABELS: Record<LifeEventKind, string> = {
  padel: 'Pádel',
  football: 'Fútbol',
  other_sport: 'Otro deporte',
  injury: 'Lesión / molestia',
  illness: 'Enfermedad',
  overload: 'Sobrecarga',
  work: 'Trabajo',
  stress: 'Estrés',
  travel: 'Viaje',
  social: 'Plan social',
  exam: 'Exámenes',
  other: 'Otro',
};

const DISTANCE_LABELS: Record<RaceDistance, string> = {
  sprint: 'Triatlón sprint',
  olympic: 'Triatlón olímpico',
  half: 'Triatlón media distancia',
  full: 'Triatlón distancia completa',
  run_5k: '5 km',
  run_10k: '10 km',
  run_half: 'Media maratón',
  run_marathon: 'Maratón',
  other: 'Otra',
};

export const sportLabel = (s: Sport): string => SPORT_LABELS[s] ?? s;
export const intensityLabel = (i: Intensity): string => INTENSITY_LABELS[i] ?? i;
export const lifeEventLabel = (k: LifeEventKind): string => LIFE_EVENT_LABELS[k] ?? k;
export const raceDistanceLabel = (d: RaceDistance): string => DISTANCE_LABELS[d] ?? d;

/** 45 → "45'", 75 → "1h 15'", 120 → "2h". */
export function formatDuration(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}'`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}h` : `${h}h ${rest}'`;
}

/** Swim "2.500 m", others "42,2 km". */
export function formatDistance(meters: number, sport: Sport): string {
  if (sport === 'swim') return `${Math.round(meters).toLocaleString('es-ES')} m`;
  return `${(meters / 1000).toFixed(1).replace('.', ',')} km`;
}
