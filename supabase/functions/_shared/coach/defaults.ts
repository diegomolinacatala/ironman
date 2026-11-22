/**
 * Server-side defaults for what the coach may leave out to keep its answer
 * short: a session the model adds without a prescription gets a sensible one
 * built from its intensity and the athlete's own zone numbers (the context's
 * `athlete.zones`, computed by the mirrored domain/zones.ts), so every new
 * session still says what it is for, which numbers rule it and how to know it
 * went well. Never invents numbers: without zones the key is the RPE/feel
 * only. Pure.
 */
import { zoneName } from '../planning/domain/zones.ts';
import type { Intensity, PlanChange, Sport, WorkoutCoaching, WorkoutDraft } from '../types.ts';
import { clipText } from './prescription.ts';
import { COACHING_LIMITS } from '../planning/changes.ts';

const OBJECTIVE: Record<Intensity, string> = {
  recovery: 'Recuperar: mover las piernas muy suave para llegar fresco a lo siguiente.',
  endurance: 'Sumar base aeróbica a ritmo cómodo.',
  tempo: 'Trabajar ritmo sostenido, algo exigente pero controlado.',
  threshold: 'Subir tu umbral con bloques duros y sostenidos.',
  vo2: 'Mejorar tu potencia aeróbica máxima con series cortas e intensas.',
  race: 'Ensayar el ritmo de carrera y las sensaciones del día D.',
};

const SUCCESS: Record<Intensity, string> = {
  recovery: 'Terminas con la sensación de haber hecho menos de lo que podías.',
  endurance: 'Puedes hablar en frases completas durante toda la sesión.',
  tempo: 'Mantienes el ritmo sin ir a más en la segunda mitad.',
  threshold: 'La última serie sale igual de fuerte que la primera.',
  vo2: 'Completas las series con la misma calidad, sin hundirte en las últimas.',
  race: 'Sostienes el ritmo objetivo sin forzar y con buena técnica.',
};

const EASY: ReadonlySet<Intensity> = new Set(['recovery', 'endurance']);
const PLAN_B = 'Si no es tu día: acórtala a la mitad y hazla en Z2 suave.';

type ZoneSport = 'run' | 'bike' | 'swim';

function zoneSport(sport: Sport): ZoneSport | null {
  if (sport === 'run' || sport === 'bike' || sport === 'swim') return sport;
  return sport === 'brick' ? 'bike' : null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** "Z2: 145–151 ppm · 5:08–5:48 /km · RPE 3–4" from `athlete.zones`, or null. */
export function zoneKey(zones: unknown, sport: Sport, intensity: Intensity): string | null {
  const key = zoneSport(sport);
  if (!key || !isObj(zones) || !isObj(zones[key])) return null;
  const name = zoneName(intensity);
  const line = (zones[key] as Obj)[name];
  return typeof line === 'string' && line.trim() ? clipText(`${name}: ${line}`, COACHING_LIMITS.key) : null;
}

/** A default prescription for a new session (null for rest, mobility and strength: no zones to copy). */
export function defaultCoaching(draft: Pick<WorkoutDraft, 'sport' | 'intensity'>, zones: unknown): WorkoutCoaching | null {
  if (draft.sport === 'rest') return null;
  const key = zoneKey(zones, draft.sport, draft.intensity);
  return {
    objective: OBJECTIVE[draft.intensity],
    keys: key ? [key] : [],
    success: SUCCESS[draft.intensity],
    planB: EASY.has(draft.intensity) ? null : PLAN_B,
  };
}

/** Adds a default prescription to the new sessions the model sent without one (immutable). */
export function withDefaultCoaching(changes: readonly PlanChange[], zones: unknown): PlanChange[] {
  return changes.map((change) => {
    if (change.op !== 'add' || change.workout.coaching) return change;
    const coaching = defaultCoaching(change.workout, zones);
    return coaching ? { ...change, workout: { ...change.workout, coaching } } : change;
  });
}
