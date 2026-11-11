import { buildPlanningContext } from '../../planning/context.ts';
import { dateSchema } from '../../planning/changes.ts';
import { boolean, enumOf, object, optional } from '../../schema.ts';
import { defineTool, READ_ONLY, toolOk } from '../tool.ts';
import type { RegisteredTool } from '../tool.ts';

const input = object({
  week_start: optional(
    dateSchema('Cualquier día de la semana a consultar (se normaliza al lunes). Por defecto, la semana actual en Europe/Madrid.'),
  ),
  detail: optional(
    enumOf(
      ['concise', 'detailed'],
      'concise (por defecto): lo necesario para planificar (8 semanas de season). detailed: añade la prescripción completa y los pasos de cada entreno, 16 semanas de season, 14 días de bienestar, sesiones recientes con plan frente a hecho y nutrición de los últimos 3 días.',
    ),
  ),
  include_next_week: optional(boolean('true para incluir también la semana siguiente (útil a partir del jueves o para planificar dos semanas).')),
});

export const getPlanningContextTool: RegisteredTool = defineTool({
  name: 'get_planning_context',
  title: 'Contexto para planificar la semana',
  description: [
    'Devuelve en una sola llamada todo lo necesario para planificar o replanificar una semana del usuario:',
    'perfil (nivel, deportes, umbrales FTP/ritmo/CSS/FC, su reloj en athlete.watchBrand: garmin o coros), sus zonas con cifras (athlete.zones: Z1-Z5 y ritmo de carrera por deporte en ppm, ritmo, vatios y RPE; missing = umbrales que faltan),',
    'disponibilidad (horas objetivo, día de descanso, días largos, días de piscina, franjas), carreras objetivo (prioridad A/B/C, días que faltan),',
    'la semana como la ve la app (phase: fase, weekLabel Carga/Más volumen/Descarga…, targetMinutes y focus, con el ajuste del plan general aplicado) y season (las próximas semanas por encima: fixed = no admite ajuste, adjusted = ya ajustada),',
    'entrenos de la semana con su id (UUID), fecha, hora, deporte, duración en minutos, intensidad, estado (planned/completed/skipped), targets (la serie principal con sus cifras), su prescripción (objective/coaching), plan frente a hecho de los completados (planVsDone), si son clave (isKey) o quedadas con amigos (jointSessionId, partners),',
    'totales planificado/hecho, imprevistos registrados, franjas ocupadas del calendario (solo horas, sin títulos), check-ins y métricas del reloj (Garmin o COROS) o de Apple Salud con señales de fatiga,',
    'carga semanal de las 6 semanas anteriores y la lista de amigos.',
    'Los ids de entrenos son los que usa propose_plan_changes (workoutId).',
  ].join(' '),
  input,
  annotations: { title: 'Contexto para planificar la semana', ...READ_ONLY },
  handler: async (args, ctx) => {
    const context = await buildPlanningContext(ctx.store, {
      userId: ctx.userId,
      weekStart: args.week_start,
      now: ctx.now(),
      detail: args.detail ?? 'concise',
      includeNextWeek: args.include_next_week ?? false,
    });
    return toolOk({ ...context });
  },
});
