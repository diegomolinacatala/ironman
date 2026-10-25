/** Quick templates for the workout editor (one tap fills the form). */
import type { Intensity, Sport, WorkoutStep } from '@/domain/types';

export interface WorkoutTemplate {
  id: string;
  sport: Sport;
  title: string;
  durationMin: number;
  intensity: Intensity;
  distanceM?: number;
  isKey?: boolean;
  description?: string;
  steps: WorkoutStep[];
}

const TEMPLATES: readonly WorkoutTemplate[] = [
  {
    id: 'run-z2-45',
    sport: 'run',
    title: "Rodaje Z2 45'",
    durationMin: 45,
    intensity: 'endurance',
    description: 'Rodaje cómodo, puedes hablar. Acaba con 4-6 progresivos de 20".',
    steps: [
      { kind: 'warmup', durationMin: 10, intensity: 'recovery' },
      { kind: 'work', durationMin: 30, intensity: 'endurance' },
      { kind: 'cooldown', durationMin: 5, intensity: 'recovery' },
    ],
  },
  {
    id: 'run-6x1000',
    sport: 'run',
    title: 'Series 6×1000',
    durationMin: 60,
    intensity: 'threshold',
    isKey: true,
    description: '6 × 1000 m a ritmo umbral, recuperación 2\' al trote.',
    steps: [
      { kind: 'warmup', durationMin: 15, intensity: 'endurance' },
      { kind: 'work', durationMin: 4, intensity: 'threshold', repeat: 6 },
      { kind: 'recovery', durationMin: 2, intensity: 'recovery', repeat: 6 },
      { kind: 'cooldown', durationMin: 9, intensity: 'recovery' },
    ],
  },
  {
    id: 'run-long-90',
    sport: 'run',
    title: 'Tirada larga 1h30',
    durationMin: 90,
    intensity: 'endurance',
    isKey: true,
    description: 'Ritmo de fondo constante. Practica tu hidratación.',
    steps: [
      { kind: 'warmup', durationMin: 10, intensity: 'recovery' },
      { kind: 'work', durationMin: 75, intensity: 'endurance' },
      { kind: 'cooldown', durationMin: 5, intensity: 'recovery' },
    ],
  },
  {
    id: 'bike-trainer-tempo',
    sport: 'bike',
    title: 'Rodillo 1h tempo',
    durationMin: 60,
    intensity: 'tempo',
    description: '3 × 12\' en tempo (Z3) con 4\' suaves entre bloques.',
    steps: [
      { kind: 'warmup', durationMin: 12, intensity: 'endurance' },
      { kind: 'work', durationMin: 12, intensity: 'tempo', repeat: 3 },
      { kind: 'recovery', durationMin: 4, intensity: 'recovery', repeat: 2 },
      { kind: 'cooldown', durationMin: 4, intensity: 'recovery' },
    ],
  },
  {
    id: 'bike-long-3h',
    sport: 'bike',
    title: 'Fondo 3h',
    durationMin: 180,
    intensity: 'endurance',
    isKey: true,
    description: 'Salida larga en Z2. Come 60-90 g/h de hidratos.',
    steps: [
      { kind: 'warmup', durationMin: 20, intensity: 'recovery' },
      { kind: 'work', durationMin: 150, intensity: 'endurance' },
      { kind: 'cooldown', durationMin: 10, intensity: 'recovery' },
    ],
  },
  {
    id: 'swim-tech-2000',
    sport: 'swim',
    title: 'Técnica 2.000 m',
    durationMin: 45,
    intensity: 'endurance',
    distanceM: 2000,
    description: '400 calentamiento · 12 × 50 técnica · 4 × 200 Z2 · 200 suave.',
    steps: [
      { kind: 'warmup', distanceM: 400, intensity: 'recovery' },
      { kind: 'work', distanceM: 50, intensity: 'endurance', repeat: 12, note: 'Ejercicios de técnica' },
      { kind: 'work', distanceM: 200, intensity: 'endurance', repeat: 4 },
      { kind: 'cooldown', distanceM: 200, intensity: 'recovery' },
    ],
  },
  {
    id: 'swim-css-10x100',
    sport: 'swim',
    title: 'CSS 10×100',
    durationMin: 50,
    intensity: 'threshold',
    distanceM: 2200,
    isKey: true,
    description: '10 × 100 a ritmo CSS, descanso 15-20".',
    steps: [
      { kind: 'warmup', distanceM: 600, intensity: 'endurance' },
      { kind: 'work', distanceM: 100, intensity: 'threshold', repeat: 10 },
      { kind: 'cooldown', distanceM: 600, intensity: 'recovery' },
    ],
  },
  {
    id: 'strength-45',
    sport: 'strength',
    title: "Fuerza 45'",
    durationMin: 45,
    intensity: 'tempo',
    description: 'Sentadilla, peso muerto rumano, step-up y gemelo: 3-4 × 6.',
    steps: [
      { kind: 'warmup', durationMin: 10, intensity: 'recovery' },
      { kind: 'work', durationMin: 30, intensity: 'tempo' },
      { kind: 'cooldown', durationMin: 5, intensity: 'recovery' },
    ],
  },
  {
    id: 'brick-90-20',
    sport: 'brick',
    title: "Brick 1h30+20'",
    durationMin: 110,
    intensity: 'tempo',
    isKey: true,
    description: "Bici 1h30 con 2 × 15' a ritmo de carrera + transición rápida + 20' de carrera.",
    steps: [
      { kind: 'warmup', durationMin: 15, intensity: 'endurance', note: 'Bici' },
      { kind: 'work', durationMin: 15, intensity: 'race', repeat: 2, note: 'Bici a ritmo de carrera' },
      { kind: 'work', durationMin: 45, intensity: 'endurance', note: 'Bici' },
      { kind: 'work', durationMin: 20, intensity: 'tempo', note: 'Carrera' },
    ],
  },
  {
    id: 'mobility-20',
    sport: 'mobility',
    title: "Movilidad 20'",
    durationMin: 20,
    intensity: 'recovery',
    steps: [],
  },
  {
    id: 'rest-day',
    sport: 'rest',
    title: 'Descanso',
    durationMin: 0,
    intensity: 'recovery',
    steps: [],
  },
];

/** Templates for a sport (all when the sport has none). */
export function templatesFor(sport: Sport): WorkoutTemplate[] {
  return TEMPLATES.filter((t) => t.sport === sport);
}

export function allTemplates(): readonly WorkoutTemplate[] {
  return TEMPLATES;
}
