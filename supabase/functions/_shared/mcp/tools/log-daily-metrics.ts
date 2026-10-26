import { addDays, DEFAULT_TZ, isIsoDate, todayIn } from '../../dates.ts';
import { dateSchema } from '../../planning/changes.ts';
import type { MetricsUpsert } from '../../planning/store.ts';
import { array, integer, number, object, optional, string } from '../../schema.ts';
import type { Infer } from '../../schema.ts';
import { defineTool, toolOk, ToolInputError } from '../tool.ts';
import type { RegisteredTool } from '../tool.ts';

const day = object({
  date: dateSchema('Día al que corresponden los datos (YYYY-MM-DD; el sueño y la VFC son los de la noche anterior a ese día).'),
  hrv_ms: optional(number({ min: 1, max: 300, description: 'VFC/HRV nocturna media en ms.' })),
  resting_hr: optional(number({ min: 25, max: 120, description: 'FC en reposo en lpm.' })),
  sleep_hours: optional(number({ min: 0, max: 16, description: 'Horas de sueño (p. ej. 7.5).' })),
  sleep_score: optional(number({ min: 0, max: 100, description: 'Puntuación de sueño de Garmin 0-100.' })),
  body_battery: optional(number({ min: 0, max: 100, description: 'Body Battery al despertar (o máximo del día) 0-100.' })),
  training_readiness: optional(number({ min: 0, max: 100, description: 'Training Readiness de Garmin 0-100.' })),
  vo2max: optional(number({ min: 10, max: 100, description: 'VO2max estimado (ml/kg/min).' })),
  steps: optional(integer({ min: 0, max: 150000, description: 'Pasos del día.' })),
  stress_avg: optional(number({ min: 0, max: 100, description: 'Estrés medio de Garmin 0-100.' })),
  training_status: optional(string({ min: 1, max: 60, description: 'Estado de entrenamiento de Garmin tal cual (p. ej. "Productive", "Maintaining").' })),
});

const input = object({
  days: array(day, { min: 1, max: 31, description: 'Uno o varios días; solo incluye los campos que conozcas.' }),
});

const FIELD_MAP = {
  hrv_ms: 'hrvMs',
  resting_hr: 'restingHr',
  sleep_hours: 'sleepHours',
  sleep_score: 'sleepScore',
  body_battery: 'bodyBattery',
  training_readiness: 'trainingReadiness',
  vo2max: 'vo2max',
  steps: 'steps',
  stress_avg: 'stressAvg',
  training_status: 'trainingStatus',
} as const;

export function toMetricsUpsert(d: Infer<typeof day>, nowIso: string): MetricsUpsert {
  const fields = Object.fromEntries(
    Object.entries(FIELD_MAP)
      .filter(([snake]) => d[snake as keyof typeof d] !== undefined)
      .map(([snake, camel]) => [camel, d[snake as keyof typeof d]]),
  ) as Partial<Omit<MetricsUpsert, 'date' | 'raw'>>;
  return { date: d.date, ...fields, raw: { source: 'Garmin', via: 'claude_bridge', loggedAt: nowIso } };
}

export const logDailyMetricsTool: RegisteredTool = defineTool({
  name: 'log_daily_metrics',
  title: 'Guardar métricas diarias de Garmin',
  description: [
    'Guarda en Road to Ironman un resumen diario de bienestar leído de Garmin (VFC/HRV en ms, FC en reposo en lpm, horas y puntuación de sueño, Body Battery, Training Readiness, VO2max, pasos, estrés medio, estado de entrenamiento).',
    'Se fusiona con lo que ya hubiera para ese día: los campos que no envíes se conservan. Úsala con los datos reales del conector de Garmin; no inventes valores.',
    'Hasta 31 días por llamada; fechas de los últimos 365 días.',
  ].join(' '),
  input,
  annotations: { title: 'Guardar métricas diarias de Garmin', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (args, ctx) => {
    const profile = await ctx.store.getProfile(ctx.userId);
    const today = todayIn(profile?.timezone ?? DEFAULT_TZ, ctx.now());
    const bad = args.days.find((d) => !isIsoDate(d.date) || d.date > addDays(today, 1) || d.date < addDays(today, -365));
    if (bad) throw new ToolInputError(`Fecha ${bad.date} no válida: debe ser real, no futura y de los últimos 365 días (hoy es ${today}).`);
    const empty = args.days.find((d) => Object.keys(d).length === 1);
    if (empty) throw new ToolInputError(`El día ${empty.date} no trae ninguna métrica; incluye al menos un campo.`);
    const nowIso = ctx.now().toISOString();
    const rows = args.days.map((d) => toMetricsUpsert(d, nowIso));
    const saved = await ctx.store.upsertMetrics(ctx.userId, 'garmin', rows);
    return toolOk({ saved, dates: rows.map((r) => r.date), source: 'Garmin' });
  },
});
