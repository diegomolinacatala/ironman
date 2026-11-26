/**
 * Structured output of the plan reader: strict JSON Schema for the model, then
 * a defensive normalization into the loose session shape the app's
 * `buildPlan` (src/domain/planImport.ts) finishes: enums checked, numbers
 * bounded, rest days dropped, at most 400 sessions. The app re-validates.
 */
import { clipWords, plainText } from '../ai/gate.ts';
import { CoachAiError } from '../coach/ports.ts';
import { isIsoDate } from '../dates.ts';
import { array, enumOf, integer, nullable, object, string, toStructuredOutputSchema } from '../schema.ts';
import { INTENSITIES, SPORTS } from '../types.ts';

export const CONFIDENCES = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCES)[number];
export const STEP_KINDS = ['warmup', 'work', 'recovery', 'cooldown', 'rest'] as const;
export const MAX_SESSIONS = 400;
export const MAX_WEEKS = 60;
export const MAX_STEPS = 50;

const stepSchema = object({
  kind: enumOf(STEP_KINDS),
  duration_min: nullable(integer({ description: 'Minutos del paso o null.' })),
  distance_m: nullable(integer({ description: 'Metros del paso o null.' })),
  repeat: nullable(integer({ description: 'Repeticiones de la serie o null.' })),
  intensity: nullable(enumOf(INTENSITIES)),
});

const sessionSchema = object({
  week: integer({ description: 'Semana del plan, 1 = la primera.' }),
  day: integer({ description: 'Día de la semana: 0 lunes, 1 martes, 2 miércoles, 3 jueves, 4 viernes, 5 sábado, 6 domingo.' }),
  date: nullable(string({ description: 'Fecha YYYY-MM-DD si el plan la escribe; si no, null.' })),
  sport: enumOf(SPORTS),
  title: string({ min: 1, description: 'Título corto en español ("Rodaje Z2", "Series 4×8\'").' }),
  duration_min: nullable(integer({ description: 'Duración total en minutos o null si no se indica.' })),
  distance_m: nullable(integer({ description: 'Distancia total en metros o null.' })),
  intensity: nullable(enumOf(INTENSITIES, 'recovery Z1, endurance Z2, tempo Z3, threshold Z4, vo2 Z5, race ritmo de carrera.')),
  description: nullable(string({ description: 'Lo que escribe el entrenador de la sesión, resumido (máx. 300 caracteres).' })),
  steps: array(stepSchema),
  confidence: enumOf(CONFIDENCES),
});

const outputSchema = object({
  title: nullable(string({ description: 'Nombre del plan o null.' })),
  confidence: enumOf(CONFIDENCES),
  notes: array(string(), { description: 'Avisos cortos para el atleta (lo que no se ha podido leer), máximo 3.' }),
  sessions: array(sessionSchema),
});

export const PLAN_OUTPUT_JSON_SCHEMA = toStructuredOutputSchema(outputSchema.json) as Record<string, unknown>;

export interface LooseStep {
  kind: (typeof STEP_KINDS)[number];
  durationMin?: number;
  distanceM?: number;
  repeat?: number;
  intensity?: (typeof INTENSITIES)[number];
}

export interface LooseSession {
  week?: number;
  day?: number;
  sourceDate?: string;
  sport: (typeof SPORTS)[number];
  title: string;
  durationMin: number | null;
  distanceM: number | null;
  intensity: (typeof INTENSITIES)[number] | null;
  description: string | null;
  steps: LooseStep[];
  confidence: Confidence;
}

/** What the function answers (the app builds its `ImportedPlan` from it). */
export interface PlanImportResponse {
  title: string | null;
  confidence: Confidence;
  warnings: string[];
  sessions: LooseSession[];
  engine: 'ai';
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(values: readonly T[], v: unknown): T | null =>
  typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : null;

function int(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n >= min && n <= max ? n : null;
}

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = plainText(v);
  return s ? clipWords(s, max) : null;
}

function steps(v: unknown): LooseStep[] {
  if (!Array.isArray(v)) return [];
  const out: LooseStep[] = [];
  for (const raw of v.slice(0, MAX_STEPS)) {
    if (!isObj(raw)) continue;
    const durationMin = int(raw.duration_min, 1, 720);
    const distanceM = int(raw.distance_m, 1, 1_000_000);
    if (durationMin === null && distanceM === null) continue;
    const repeat = int(raw.repeat, 2, 50);
    const intensity = oneOf(INTENSITIES, raw.intensity);
    out.push({
      kind: oneOf(STEP_KINDS, raw.kind) ?? 'work',
      ...(durationMin !== null ? { durationMin } : {}),
      ...(distanceM !== null ? { distanceM } : {}),
      ...(repeat !== null ? { repeat } : {}),
      ...(intensity ? { intensity } : {}),
    });
  }
  return out;
}

function session(raw: unknown): LooseSession | null {
  if (!isObj(raw)) return null;
  const sport = oneOf(SPORTS, raw.sport);
  if (!sport || sport === 'rest') return null;
  const date = typeof raw.date === 'string' && isIsoDate(raw.date) ? raw.date : null;
  const week = int(raw.week, 1, MAX_WEEKS);
  const day = int(raw.day, 0, 6);
  if (!date && (week === null || day === null)) return null;
  return {
    ...(date ? { sourceDate: date } : { week: week as number, day: day as number }),
    sport,
    title: text(raw.title, 80) ?? '',
    durationMin: int(raw.duration_min, 1, 720),
    distanceM: int(raw.distance_m, 1, 1_000_000),
    intensity: oneOf(INTENSITIES, raw.intensity),
    description: text(raw.description, 300),
    steps: steps(raw.steps),
    confidence: oneOf(CONFIDENCES, raw.confidence) ?? 'medium',
  };
}

/** Model JSON → response. Throws `bad_output` when there is no session list at all. */
export function toPlanImportResponse(raw: Record<string, unknown>): PlanImportResponse {
  if (!Array.isArray(raw.sessions)) throw new CoachAiError('bad_output', 'La lectura del plan no tenía el formato esperado.');
  const sessions = raw.sessions.map(session).filter((s): s is LooseSession => s !== null).slice(0, MAX_SESSIONS);
  const notes = Array.isArray(raw.notes) ? raw.notes.map((n) => text(n, 160)).filter((n): n is string => Boolean(n)).slice(0, 3) : [];
  return {
    title: text(raw.title, 120),
    confidence: oneOf(CONFIDENCES, raw.confidence) ?? 'medium',
    warnings: notes,
    sessions,
    engine: 'ai',
  };
}
