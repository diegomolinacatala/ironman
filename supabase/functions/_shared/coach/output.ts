/**
 * Structured output of the AI coach: a flat, all-required-but-nullable change
 * shape (structured outputs need every property listed and no numeric bounds),
 * converted to camelCase `PlanChange` and re-validated with the strict schema.
 * v2 adds `memory` (facts to remember) and `life_event` (imprevisto to log);
 * both are validated on their own so a bad one never discards the reply.
 */
import { planChangeSchema } from '../planning/changes.ts';
import { array, boolean, enumOf, intEnum, integer, nullable, object, string, toStructuredOutputSchema } from '../schema.ts';
import type { Infer, Schema } from '../schema.ts';
import { BODY_AREAS, INTENSITIES, LIFE_EVENT_KINDS, SPORTS } from '../types.ts';
import type { PlanChange, WorkoutDraft } from '../types.ts';

export const MAX_COACH_CHANGES = 30;

const flatChangeShape = {
  op: enumOf(['add', 'update', 'move', 'delete'] as const),
  workoutId: nullable(string({ description: 'Id del entreno (update/move/delete) o null (add).' })),
  reason: string({ description: 'Motivo en una frase.' }),
  date: nullable(string({ format: 'date', description: 'YYYY-MM-DD (add: fecha; move: nueva fecha; update: nueva fecha o null).' })),
  startTime: nullable(string({ description: 'HH:mm o null.' })),
  sport: nullable(enumOf(SPORTS)),
  title: nullable(string()),
  description: nullable(string()),
  durationMin: nullable(integer()),
  distanceM: nullable(integer()),
  intensity: nullable(enumOf(INTENSITIES)),
  isKey: nullable(boolean()),
};

const flatChange = object(flatChangeShape);
/** Same shape, but extra keys from weaker models are ignored instead of rejecting the change. */
const lenientFlatChange = object(flatChangeShape, undefined, { stripUnknown: true });

/** Defaults for the nullable fields some open models leave out. */
const CHANGE_DEFAULTS: Record<string, unknown> = {
  workoutId: null,
  reason: '',
  date: null,
  startTime: null,
  sport: null,
  title: null,
  description: null,
  durationMin: null,
  distanceM: null,
  intensity: null,
  isKey: null,
};

/** Imprevisto the coach wants to log (validated later against today's date). */
export const lifeEventOutputSchema = object({
  kind: enumOf(LIFE_EVENT_KINDS),
  title: string({ min: 1, description: 'Título corto en español ("Molestia en la rodilla", "Viaje a Bilbao").' }),
  start_date: string({ format: 'date', description: 'YYYY-MM-DD.' }),
  end_date: nullable(string({ format: 'date', description: 'YYYY-MM-DD o null si es un solo día.' })),
  severity: intEnum([1, 2, 3] as const, '1 leve, 2 moderado, 3 serio.'),
  body_area: nullable(enumOf(BODY_AREAS, 'Solo para lesiones o molestias.')),
  notes: nullable(string()),
});

export type LifeEventOutput = Infer<typeof lifeEventOutputSchema>;

/** Publishes the strict JSON Schema but accepts any value at runtime (checked by the caller). */
function deferred<T>(schema: Schema<T>): Schema<unknown> {
  return { json: schema.json, parse: (input) => ({ ok: true, value: input }) };
}

export const coachOutputSchema = object({
  reply: string({ min: 1, description: 'Respuesta al atleta en español.' }),
  summary: string({ description: 'Resumen de una línea de la propuesta.' }),
  changes: array(flatChange),
  memory: array(string(), { description: '0-3 hechos o preferencias duraderas del atleta (≤ 140 caracteres cada uno).' }),
  life_event: deferred(nullable(lifeEventOutputSchema)),
});

type FlatChange = Infer<typeof flatChange>;

export interface CoachOutput {
  reply: string;
  summary: string;
  changes: FlatChange[];
  memory: string[];
  /** Validated later (toLifeEventInsert); anything here is untrusted. */
  life_event: unknown;
  /** Changes whose shape was unusable (counted as dropped in the reply). */
  malformedChanges: number;
}

/** JSON Schema sent as `output_config.format.schema`. */
export const COACH_OUTPUT_JSON_SCHEMA = toStructuredOutputSchema(coachOutputSchema.json) as Record<string, unknown>;

function definedFields(c: FlatChange): Partial<WorkoutDraft> {
  return {
    ...(c.date !== null ? { date: c.date } : {}),
    ...(c.startTime !== null ? { startTime: c.startTime } : {}),
    ...(c.sport !== null ? { sport: c.sport } : {}),
    ...(c.title !== null ? { title: c.title } : {}),
    ...(c.description !== null ? { description: c.description } : {}),
    ...(c.durationMin !== null ? { durationMin: c.durationMin } : {}),
    ...(c.distanceM !== null ? { distanceM: c.distanceM } : {}),
    ...(c.intensity !== null ? { intensity: c.intensity } : {}),
    ...(c.isKey !== null ? { isKey: c.isKey } : {}),
  };
}

function toRawChange(c: FlatChange): Record<string, unknown> {
  switch (c.op) {
    case 'add':
      return { op: 'add', workout: definedFields(c), reason: c.reason };
    case 'update':
      return { op: 'update', workoutId: c.workoutId, patch: definedFields(c), reason: c.reason };
    case 'move':
      return {
        op: 'move',
        workoutId: c.workoutId,
        toDate: c.date,
        ...(c.startTime !== null ? { toStartTime: c.startTime } : {}),
        reason: c.reason,
      };
    case 'delete':
      return { op: 'delete', workoutId: c.workoutId, reason: c.reason };
  }
}

export interface ConvertedChanges {
  changes: PlanChange[];
  rejected: { index: number; error: string }[];
}

/** Flat model output → strictly validated PlanChange[] (invalid ones are reported, not thrown). */
export function toPlanChanges(flat: readonly FlatChange[]): ConvertedChanges {
  const changes: PlanChange[] = [];
  const rejected: ConvertedChanges['rejected'] = [];
  flat.slice(0, MAX_COACH_CHANGES).forEach((c, index) => {
    const parsed = planChangeSchema.parse(toRawChange(c), `changes[${index}]`);
    if (parsed.ok) changes.push(parsed.value);
    else rejected.push({ index, error: parsed.error });
  });
  flat.slice(MAX_COACH_CHANGES).forEach((_, i) => rejected.push({ index: MAX_COACH_CHANGES + i, error: 'demasiados cambios' }));
  return { changes, rejected };
}

function parseChanges(raw: unknown): { changes: FlatChange[]; malformed: number } {
  if (raw === undefined || raw === null) return { changes: [], malformed: 0 };
  if (!Array.isArray(raw)) return { changes: [], malformed: 1 };
  const parsed = raw.map((item) =>
    lenientFlatChange.parse(typeof item === 'object' && item !== null && !Array.isArray(item) ? { ...CHANGE_DEFAULTS, ...item } : item, ''),
  );
  return {
    changes: parsed.flatMap((p) => (p.ok ? [p.value] : [])),
    malformed: parsed.filter((p) => !p.ok).length,
  };
}

/**
 * Parses the model text (JSON). Degrades gracefully for weaker models: only a non-empty
 * `reply` is mandatory; malformed changes are dropped (and counted), `summary` defaults to
 * '', `memory` keeps only strings and `life_event` is checked later. Null → bad output.
 */
export function parseCoachOutput(text: string): CoachOutput | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const reply = typeof v.reply === 'string' ? v.reply.trim() : '';
  if (!reply) return null;
  const { changes, malformed } = parseChanges(v.changes);
  return {
    reply,
    summary: typeof v.summary === 'string' ? v.summary.trim() : '',
    changes,
    memory: Array.isArray(v.memory) ? v.memory.filter((m): m is string => typeof m === 'string') : [],
    life_event: v.life_event ?? null,
    malformedChanges: malformed,
  };
}
