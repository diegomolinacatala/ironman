import { diffDays, isIsoDate } from '../../dates.ts';
import { dateSchema, timeSchema } from '../../planning/changes.ts';
import { lifeEventLabel } from '../../planning/labels.ts';
import { enumOf, intEnum, integer, nullable, object, optional, string } from '../../schema.ts';
import { BODY_AREAS, LIFE_EVENT_KINDS } from '../../types.ts';
import type { LifeEvent } from '../../types.ts';
import { defineTool, toolOk, ToolInputError } from '../tool.ts';
import type { RegisteredTool } from '../tool.ts';

const input = object({
  kind: enumOf(
    LIFE_EVENT_KINDS,
    'padel, football (fútbol), other_sport (tenis, baloncesto, senderismo…), injury (lesión o molestia), illness (enfermedad), overload (sobrecarga muscular), work (pico de trabajo), stress, travel (viaje), social (boda, cena…), exam (exámenes), other.',
  ),
  title: string({ min: 1, max: 120, description: 'Texto corto en español, p. ej. "Pádel con el trabajo" o "Molestia en el gemelo".' }),
  start_date: dateSchema('Primer día (YYYY-MM-DD, Europe/Madrid).'),
  end_date: optional(dateSchema('Último día incluido; por defecto igual que start_date. Máximo 120 días.')),
  start_time: optional(nullable(timeSchema('Hora de inicio HH:mm si aplica (partidos, viajes).'))),
  duration_min: optional(nullable(integer({ min: 0, max: 1440, description: 'Duración en minutos (partidos, otros deportes).' }))),
  severity: intEnum([1, 2, 3], 'Intensidad del deporte o gravedad: 1 = baja, 2 = media, 3 = alta.'),
  body_area: optional(nullable(enumOf(BODY_AREAS, 'Zona del cuerpo (solo para injury/overload).'))),
  notes: optional(nullable(string({ max: 2000, description: 'Detalles: dolor 0-10, síntomas, RPE del partido…' }))),
});

const HEALTH_KINDS = new Set(['injury', 'illness', 'overload']);

export const logLifeEventTool: RegisteredTool = defineTool({
  name: 'log_life_event',
  title: 'Registrar imprevisto',
  description: [
    'Registra un imprevisto en el calendario del usuario: otro deporte (pádel, fútbol…), lesión o molestia, enfermedad, sobrecarga, pico de trabajo, estrés, viaje, plan social o exámenes.',
    'Los imprevistos cuentan para la carga y las restricciones al replanificar. Devuelve el imprevisto creado y los entrenos planificados de esos días (con id) que podrían verse afectados.',
    'Si ya existe uno idéntico (mismo tipo, título y fecha) devuelve el existente en vez de duplicarlo.',
  ].join(' '),
  input,
  annotations: { title: 'Registrar imprevisto', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (args, ctx) => {
    const endDate = args.end_date ?? args.start_date;
    if (!isIsoDate(args.start_date) || !isIsoDate(endDate)) throw new ToolInputError('start_date o end_date no es una fecha real.');
    if (endDate < args.start_date) throw new ToolInputError('end_date no puede ser anterior a start_date.');
    if (diffDays(endDate, args.start_date) > 120) throw new ToolInputError('Un imprevisto puede durar como máximo 120 días.');
    const existing = (await ctx.store.listLifeEvents(ctx.userId, args.start_date, endDate)).find(
      (e: LifeEvent) => e.kind === args.kind && e.startDate === args.start_date && e.title.toLowerCase() === args.title.toLowerCase(),
    );
    const event =
      existing ??
      (await ctx.store.insertLifeEvent(ctx.userId, {
        kind: args.kind,
        title: args.title,
        startDate: args.start_date,
        endDate,
        startTime: args.start_time ?? null,
        durationMin: args.duration_min ?? null,
        severity: args.severity,
        bodyArea: args.body_area ?? null,
        notes: args.notes ?? null,
      }));
    const affected = (await ctx.store.listWorkouts(ctx.userId, args.start_date, endDate))
      .filter((w) => w.status === 'planned')
      .map((w) => ({ id: w.id, date: w.date, sport: w.sport, title: w.title, durationMin: w.durationMin, intensity: w.intensity, isKey: w.isKey, jointSessionId: w.jointSessionId }));
    return toolOk({
      created: !existing,
      event: { ...event, kindLabel: lifeEventLabel(event.kind) },
      affectedWorkouts: affected,
      next: 'Para adaptar el plan, usa propose_plan_changes con los ids de affectedWorkouts.',
      ...(HEALTH_KINDS.has(args.kind)
        ? { safety: 'Road to Ironman no es un servicio médico: si el dolor es intenso, empeora o no mejora en 7-10 días, consulta a un médico o fisioterapeuta.' }
        : {}),
    });
  },
});
