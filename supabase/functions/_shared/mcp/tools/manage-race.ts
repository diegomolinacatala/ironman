import { isIsoDate } from '../../dates.ts';
import { dateSchema, uuidSchema } from '../../planning/changes.ts';
import { raceDistanceLabel } from '../../planning/labels.ts';
import type { RaceWrite } from '../../planning/store.ts';
import { enumOf, nullable, object, optional, string } from '../../schema.ts';
import type { Infer } from '../../schema.ts';
import { RACE_DISTANCES, RACE_PRIORITIES } from '../../types.ts';
import type { Race } from '../../types.ts';
import { defineTool, toolOk, ToolInputError } from '../tool.ts';
import type { RegisteredTool, ToolContext, ToolResult } from '../tool.ts';

const input = object({
  race_id: optional(uuidSchema('Id de una carrera existente para modificarla (de get_planning_context.races). Omítelo para crear una nueva.')),
  name: optional(string({ min: 1, max: 120, description: 'Nombre de la carrera. Obligatorio al crear.' })),
  date: optional(dateSchema('Fecha de la carrera YYYY-MM-DD. Obligatoria al crear.')),
  distance: optional(
    enumOf(
      RACE_DISTANCES,
      'sprint, olympic, half (media distancia 1,9/90/21,1 km), full (distancia completa 3,8/180/42,2 km), run_5k, run_10k, run_half, run_marathon, other. Obligatoria al crear.',
    ),
  ),
  priority: optional(
    enumOf(RACE_PRIORITIES, 'A = objetivo principal (define la periodización), B = importante con mini-afinamiento, C = de entrenamiento. Obligatoria al crear.'),
  ),
  location: optional(nullable(string({ max: 200 }))),
  goal: optional(nullable(string({ max: 200, description: 'Objetivo libre, p. ej. "sub 5h" o "terminar".' }))),
  notes: optional(nullable(string({ max: 2000 }))),
});

type Args = Infer<typeof input>;

function patchFrom(args: Args): RaceWrite {
  const entries = Object.entries({
    name: args.name,
    date: args.date,
    distance: args.distance,
    priority: args.priority,
    location: args.location,
    goal: args.goal,
    notes: args.notes,
  }).filter(([, v]) => v !== undefined);
  return Object.fromEntries(entries) as RaceWrite;
}

function raceOut(race: Race, action: 'created' | 'updated'): ToolResult {
  return toolOk({ action, race: { ...race, distanceLabel: raceDistanceLabel(race.distance) } });
}

async function handle(args: Args, ctx: ToolContext): Promise<ToolResult> {
  if (args.date && !isIsoDate(args.date)) throw new ToolInputError(`La fecha ${args.date} no existe.`);
  const patch = patchFrom(args);
  if (args.race_id) {
    if (Object.keys(patch).length === 0) throw new ToolInputError('Indica al menos un campo a cambiar de la carrera.');
    const updated = await ctx.store.updateRace(ctx.userId, args.race_id, patch);
    if (!updated) {
      const races = await ctx.store.listRaces(ctx.userId);
      throw new ToolInputError(`La carrera ${args.race_id} no existe. Carreras del usuario: ${races.map((r) => `${r.id} (${r.name}, ${r.date})`).join('; ') || 'ninguna'}.`);
    }
    return raceOut(updated, 'updated');
  }
  const missing = (['name', 'date', 'distance', 'priority'] as const).filter((k) => args[k] === undefined);
  if (missing.length > 0) throw new ToolInputError(`Para crear una carrera faltan: ${missing.join(', ')}.`);
  const created = await ctx.store.insertRace(ctx.userId, {
    ...patch,
    name: args.name as string,
    date: args.date as string,
    distance: args.distance as Race['distance'],
    priority: args.priority as Race['priority'],
  });
  return raceOut(created, 'created');
}

export const manageRaceTool: RegisteredTool = defineTool({
  name: 'manage_race',
  title: 'Crear o modificar una carrera',
  description: [
    'Crea una carrera objetivo del usuario o modifica una existente (con race_id).',
    'Al crear son obligatorios name, date, distance y priority. Las carreras A definen las fases del plan (base, construcción, afinamiento).',
    'No borra carreras: eso se hace desde la app.',
  ].join(' '),
  input,
  annotations: { title: 'Crear o modificar una carrera', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  handler: handle,
});
