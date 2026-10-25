/**
 * Race helpers: countdown, upcoming/past split, priority copy and the season
 * phase timeline (pure).
 */
import { diffDays } from '@/domain/dates';
import { phaseLabel } from '@/domain/labels';
import type { Phase } from '@/domain/periodization';
import type { ISODate, Race, RacePriority } from '@/domain/types';

export interface Countdown {
  value: string;
  unit: string;
  /** Accessible sentence. */
  spoken: string;
}

export function countdown(raceDate: ISODate, today: ISODate): Countdown {
  const days = diffDays(raceDate, today);
  if (days === 0) return { value: 'HOY', unit: 'es el día', spoken: 'Es hoy' };
  if (days === 1) return { value: '1', unit: 'día', spoken: 'Falta 1 día' };
  if (days > 1) return { value: `${days}`, unit: 'días', spoken: `Faltan ${days} días` };
  const ago = Math.abs(days);
  return { value: `${ago}`, unit: ago === 1 ? 'día' : 'días', spoken: `Hace ${ago} ${ago === 1 ? 'día' : 'días'}` };
}

export function splitRaces(races: readonly Race[], today: ISODate): { upcoming: Race[]; past: Race[] } {
  const upcoming = races.filter((r) => r.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = races.filter((r) => r.date < today).sort((a, b) => b.date.localeCompare(a.date));
  return { upcoming, past };
}

export const PRIORITIES: readonly RacePriority[] = ['A', 'B', 'C'];

export const PRIORITY_INFO: Record<RacePriority, { title: string; help: string }> = {
  A: {
    title: 'Objetivo',
    help: 'Tu carrera de la temporada: el plan se construye hacia ella, con afinamiento completo.',
  },
  B: {
    title: 'Importante',
    help: 'Quieres hacerla bien: mini-afinamiento de 3–5 días sin romper el bloque.',
  },
  C: {
    title: 'Rodaje',
    help: 'Para coger ritmo: cuenta como sesión de calidad, sin afinamiento.',
  },
};

export interface TimelineStep {
  key: 'base' | 'build' | 'peak' | 'taper' | 'race_week';
  label: string;
  /** Relative segment width (roughly how long the phase lasts, and room for the label). */
  weight: number;
}

export const PHASE_TIMELINE: readonly TimelineStep[] = [
  { key: 'base', label: 'Base', weight: 1.1 },
  { key: 'build', label: 'Construcción', weight: 1.6 },
  { key: 'peak', label: 'Pico', weight: 0.7 },
  { key: 'taper', label: 'Puesta a punto', weight: 1.4 },
  { key: 'race_week', label: 'Carrera', weight: 1 },
];

/**
 * Position of a phase on the timeline: 0..4, -1 before Base (prep), null when
 * the phase is off the race arc (recovery / transition).
 */
export function timelineIndex(phase: string): number | null {
  if (phase === 'prep') return -1;
  const index = PHASE_TIMELINE.findIndex((s) => s.key === phase);
  return index >= 0 ? index : null;
}

/**
 * Name of a phase as shown in this area: the timeline wording for phases on
 * the race arc (Base → Construcción → Pico → Puesta a punto → Carrera), the
 * domain label otherwise (Preparación, Recuperación, Transición).
 */
export function phaseName(phase: Phase): string {
  return PHASE_TIMELINE.find((s) => s.key === phase)?.label ?? phaseLabel(phase);
}
