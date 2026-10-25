import { addDays, DEFAULT_TZ, isIsoDate, todayIn } from '../../dates.ts';
import { dateSchema } from '../../planning/changes.ts';
import { deviceSummary, toGarminWorkouts } from '../../planning/device.ts';
import { integer, object, optional } from '../../schema.ts';
import { defineTool, READ_ONLY, toolOk, ToolInputError } from '../tool.ts';
import type { RegisteredTool } from '../tool.ts';

const input = object({
  from: optional(dateSchema('Primer día (YYYY-MM-DD). Por defecto, hoy.')),
  days: optional(integer({ min: 1, max: 14, description: 'Número de días a devolver (1-14, por defecto 7).' })),
});

export const getPlanForDeviceTool: RegisteredTool = defineTool({
  name: 'get_plan_for_device',
  title: 'Entrenos para el reloj (formato Garmin)',
  description: [
    'Devuelve los próximos entrenos planificados (no completados) con su estructura en JSON compatible con los workouts de Garmin Connect',
    '(workoutName, sport RUNNING/CYCLING/LAP_SWIMMING/STRENGTH_TRAINING/OTHER, segments → steps con WARMUP/ACTIVE/RECOVERY/COOLDOWN, duraciones en segundos o metros,',
    'objetivos de potencia en vatios o de FC en lpm calculados con los umbrales del usuario, y scheduledDate).',
    'Un brick se devuelve como dos workouts (bici y carrera). Pensado para que el conector de Garmin del usuario los suba y programe en el reloj; esta herramienta no escribe en Garmin.',
  ].join(' '),
  input,
  annotations: { title: 'Entrenos para el reloj (formato Garmin)', ...READ_ONLY },
  handler: async (args, ctx) => {
    const profile = await ctx.store.getProfile(ctx.userId);
    const from = args.from ?? todayIn(profile?.timezone ?? DEFAULT_TZ, ctx.now());
    if (!isIsoDate(from)) throw new ToolInputError(`from ${from} no es una fecha real.`);
    const to = addDays(from, (args.days ?? 7) - 1);
    const thresholds = profile?.thresholds ?? {};
    const workouts = (await ctx.store.listWorkouts(ctx.userId, from, to))
      .filter((w) => w.status === 'planned' && w.sport !== 'rest')
      .sort((a, b) => (a.date + (a.startTime ?? '99')).localeCompare(b.date + (b.startTime ?? '99')));
    return toolOk({
      from,
      to,
      count: workouts.length,
      workouts: workouts.map((w) => ({
        workoutId: w.id,
        date: w.date,
        startTime: w.startTime,
        sport: w.sport,
        title: w.title,
        durationMin: w.durationMin,
        intensity: w.intensity,
        isKey: w.isKey,
        summary: deviceSummary(w, thresholds),
        garminWorkouts: toGarminWorkouts(w, thresholds),
      })),
      thresholdsUsed: thresholds,
    });
  },
});
