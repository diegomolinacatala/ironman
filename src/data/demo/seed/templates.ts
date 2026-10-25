/**
 * Weekly training templates of the demo athletes (base phase, ~10 h Diego,
 * ~9.5 h Álex). Weekday 0 = Monday.
 */
import type { Intensity, ISOTime, Sport, Weekday, WorkoutStep } from '@/domain/types';

export interface WorkoutTemplate {
  weekday: Weekday;
  start: ISOTime | null;
  sport: Sport;
  title: string;
  description?: string;
  durationMin: number;
  distanceM?: number;
  intensity: Intensity;
  isKey?: boolean;
  steps?: WorkoutStep[];
}

const THRESHOLD_BIKE_STEPS: WorkoutStep[] = [
  { kind: 'warmup', durationMin: 15, intensity: 'endurance' },
  { kind: 'work', durationMin: 8, intensity: 'threshold', repeat: 4, note: 'Al 95–100 % del FTP' },
  { kind: 'recovery', durationMin: 4, intensity: 'recovery', repeat: 4 },
  { kind: 'cooldown', durationMin: 12, intensity: 'recovery' },
];

const TEMPO_RUN_STEPS: WorkoutStep[] = [
  { kind: 'warmup', durationMin: 15, intensity: 'endurance' },
  { kind: 'work', durationMin: 8, intensity: 'tempo', repeat: 3 },
  { kind: 'recovery', durationMin: 2, intensity: 'recovery', repeat: 3 },
  { kind: 'cooldown', durationMin: 10, intensity: 'recovery' },
];

export const DIEGO_WEEK: readonly WorkoutTemplate[] = [
  {
    weekday: 1,
    start: '07:00',
    sport: 'swim',
    title: 'Técnica + aeróbico',
    description: '400 calentamiento · 8×50 técnica (pull, punto muerto) · 4×300 Z2 rec. 20" · 200 suave',
    durationMin: 60,
    distanceM: 2600,
    intensity: 'endurance',
  },
  {
    weekday: 1,
    start: '19:30',
    sport: 'run',
    title: 'Rodaje con cambios',
    description: '15\' suave + 3×8\' en Z3 rec. 2\' trote + 10\' suave',
    durationMin: 55,
    distanceM: 10000,
    intensity: 'tempo',
    steps: TEMPO_RUN_STEPS,
  },
  {
    weekday: 2,
    start: '19:00',
    sport: 'bike',
    title: "Rodillo 4×8' umbral",
    description: "15' progresivo + 4×8' al 95–100 % FTP rec. 4' + vuelta a la calma",
    durationMin: 75,
    intensity: 'threshold',
    isKey: true,
    steps: THRESHOLD_BIKE_STEPS,
  },
  {
    weekday: 3,
    start: '07:00',
    sport: 'swim',
    title: 'Series 10×100',
    description: '300 calentamiento · 10×100 a ritmo CSS rec. 15" · 300 suave',
    durationMin: 50,
    distanceM: 2400,
    intensity: 'tempo',
  },
  {
    weekday: 3,
    start: '20:00',
    sport: 'strength',
    title: 'Fuerza core y cadera',
    description: 'Sentadilla búlgara, peso muerto rumano, puente de glúteo, plancha lateral, pallof press (3×10)',
    durationMin: 40,
    intensity: 'endurance',
  },
  {
    weekday: 4,
    start: '19:30',
    sport: 'run',
    title: 'Rodaje suave Z2',
    description: 'Conversacional, cadencia alta. Terminar con 4 rectas de 20".',
    durationMin: 45,
    distanceM: 8000,
    intensity: 'endurance',
  },
  {
    weekday: 5,
    start: '08:30',
    sport: 'bike',
    title: 'Tirada larga en bici',
    description: 'Z2 constante. Come cada 30–40 min (60 g de hidratos/h).',
    durationMin: 180,
    distanceM: 80000,
    intensity: 'endurance',
    isKey: true,
  },
  {
    weekday: 6,
    start: '09:00',
    sport: 'run',
    title: 'Tirada larga',
    description: 'Z2, últimos 15 min a ritmo de media distancia si te encuentras bien.',
    durationMin: 85,
    distanceM: 15000,
    intensity: 'endurance',
    isKey: true,
  },
];

export const ALEX_WEEK: readonly WorkoutTemplate[] = [
  { weekday: 0, start: '18:30', sport: 'run', title: 'Rodaje + técnica de carrera', durationMin: 50, distanceM: 9500, intensity: 'endurance' },
  { weekday: 1, start: '06:30', sport: 'swim', title: 'Natación aeróbica', durationMin: 60, distanceM: 3000, intensity: 'endurance' },
  {
    weekday: 2,
    start: '18:30',
    sport: 'bike',
    title: "Rodillo sweet spot 3×12'",
    durationMin: 90,
    intensity: 'tempo',
    isKey: true,
  },
  { weekday: 3, start: '06:30', sport: 'swim', title: 'Series 8×100', durationMin: 45, distanceM: 2500, intensity: 'tempo' },
  { weekday: 3, start: '19:30', sport: 'run', title: "Series 6×1'", durationMin: 50, distanceM: 9000, intensity: 'vo2' },
  { weekday: 5, start: '08:30', sport: 'bike', title: 'Tirada larga en bici', durationMin: 180, distanceM: 85000, intensity: 'endurance', isKey: true },
  { weekday: 6, start: '09:30', sport: 'run', title: 'Tirada larga', durationMin: 80, distanceM: 15500, intensity: 'endurance' },
];
