import { addDays, DEFAULT_TZ, isIsoDate, todayIn } from '../../dates.ts';
import { dateSchema } from '../../planning/changes.ts';
import { toNeutralWorkouts } from '../../planning/device-neutral.ts';
import { deviceSummary, toGarminWorkouts } from '../../planning/device.ts';
import type { DeviceOptions } from '../../planning/device.ts';
import { nextRace } from '../../planning/phase.ts';
import { enumOf, integer, object, optional } from '../../schema.ts';
import { WATCH_BRANDS } from '../../types.ts';
import type { Thresholds, WatchBrand, Workout } from '../../types.ts';
import { defineTool, READ_ONLY, toolOk, ToolInputError } from '../tool.ts';
import type { RegisteredTool } from '../tool.ts';

const TITLE = 'Entrenos para el reloj (Garmin o COROS)';

const input = object({
  from: optional(dateSchema('Primer día (YYYY-MM-DD). Por defecto, hoy.')),
  days: optional(integer({ min: 1, max: 14, description: 'Número de días a devolver (1-14, por defecto 7).' })),
  watch: optional(enumOf(WATCH_BRANDS, 'Formato: garmin (JSON de Garmin) o coros (pasos para el conector de COROS). Por defecto, el reloj del perfil (athlete.watchBrand; Garmin si no ha elegido).')),
});

const HOW_TO: Readonly<Record<WatchBrand, string>> = {
  garmin:
    'Con el conector de Garmin, sube cada garminWorkouts y prográmalo en su scheduledDate (esta herramienta no escribe en el reloj). Sin conector, el atleta puede copiarlo en Garmin Connect › Entrenamiento › Entrenamientos.',
  coros:
    'Con el conector oficial de COROS, crea en su calendario cada corosWorkouts con coros "connector" (carrera y bici) con estos pasos y objetivos; llegan al reloj al sincronizar. Los marcados "manual" (natación, fuerza…) se crean a mano en la app de COROS (Perfil › Biblioteca de entrenamientos › «+»). El conector aún no mueve ni borra entrenos: si uno cambia, avisa de borrar el antiguo a mano. Los umbrales (FC máx, FC umbral, ritmo umbral, FTP) deben ser los mismos en las dos apps.',
};

const byDateTime = (a: Workout, b: Workout): number => (a.date + (a.startTime ?? '99')).localeCompare(b.date + (b.startTime ?? '99'));

function deviceView(w: Workout, watch: WatchBrand, thresholds: Thresholds, opts: DeviceOptions): Record<string, unknown> {
  return {
    workoutId: w.id,
    date: w.date,
    startTime: w.startTime,
    sport: w.sport,
    title: w.title,
    durationMin: w.durationMin,
    intensity: w.intensity,
    isKey: w.isKey,
    summary: deviceSummary(w, thresholds, opts),
    ...(w.coaching ? { objective: w.coaching.objective, success: w.coaching.success } : {}),
    ...(watch === 'garmin' ? { garminWorkouts: toGarminWorkouts(w, thresholds, opts) } : { corosWorkouts: toNeutralWorkouts(w, thresholds, opts) }),
  };
}

export const getPlanForDeviceTool: RegisteredTool = defineTool({
  name: 'get_plan_for_device',
  title: TITLE,
  description: [
    'Devuelve los próximos entrenos planificados (no completados) con su estructura lista para el reloj del usuario (Garmin o COROS), con los mismos objetivos que muestra la app:',
    'las series van en UN bloque de repetición (trabajo + recuperación), un brick se separa en bici y carrera según sus pasos, y cada paso lleva su objetivo explícito o, si no, el de las zonas del atleta.',
    'watch=garmin: garminWorkouts en JSON compatible con Garmin Connect (sport RUNNING/CYCLING/LAP_SWIMMING/STRENGTH_TRAINING/OTHER, WARMUP/ACTIVE/RECOVERY/COOLDOWN, segundos o metros, potencia en vatios o FC en ppm; ritmo, RPE y sensaciones en la descripción) para subirlos con el conector de Garmin.',
    'watch=coros: corosWorkouts con pasos neutros (durationSec o distanceM por repetición, FC en ppm y en % de la FC umbral, ritmo en segundos enteros por km o por 100 m, vatios, RPE y cue) para crearlos con el conector oficial de COROS; natación y fuerza van marcadas «créalo a mano en COROS».',
    'Esta herramienta no escribe en ningún reloj; howTo explica los pasos.',
  ].join(' '),
  input,
  annotations: { title: TITLE, ...READ_ONLY },
  handler: async (args, ctx) => {
    const profile = await ctx.store.getProfile(ctx.userId);
    const from = args.from ?? todayIn(profile?.timezone ?? DEFAULT_TZ, ctx.now());
    if (!isIsoDate(from)) throw new ToolInputError(`from ${from} no es una fecha real.`);
    const to = addDays(from, (args.days ?? 7) - 1);
    const watch: WatchBrand = args.watch ?? profile?.watchBrand ?? 'garmin';
    const thresholds = profile?.thresholds ?? {};
    const [planned, races] = await Promise.all([ctx.store.listWorkouts(ctx.userId, from, to), ctx.store.listRaces(ctx.userId)]);
    const opts: DeviceOptions = { raceDistance: nextRace(races, from)?.distance ?? null };
    const workouts = planned.filter((w) => w.status === 'planned' && w.sport !== 'rest').sort(byDateTime);
    return toolOk({
      from,
      to,
      watch,
      count: workouts.length,
      howTo: HOW_TO[watch],
      workouts: workouts.map((w) => deviceView(w, watch, thresholds, opts)),
      thresholdsUsed: thresholds,
    });
  },
});
