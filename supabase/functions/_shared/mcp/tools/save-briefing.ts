/**
 * save_briefing: the morning briefing ("Informe de hoy") written by the athlete's own Claude
 * (their Pro plan, through this connector) instead of the free in-app model. Same row and
 * limits as the `briefing` Edge Function (one per user and day, model 'claude'): the app shows
 * it and reads it aloud the next time it opens Hoy. Only yesterday, today or tomorrow
 * (Europe/Madrid by default), like the function's window.
 */
import { addDays, DEFAULT_TZ, todayIn } from '../../dates.ts';
import { dateSchema } from '../../planning/changes.ts';
import { enumOf, object, optional, string } from '../../schema.ts';
import { SLEEP_VERDICTS } from '../../types.ts';
import { defineTool, toolError, toolOk, ToolInputError } from '../tool.ts';
import type { RegisteredTool } from '../tool.ts';

export const CLAUDE_BRIEFING_MODEL = 'claude';
/** Days around today a briefing may be saved for (the app only asks for today or tomorrow). */
const WINDOW_DAYS = 1;

const input = object({
  date: dateSchema('Día del informe (YYYY-MM-DD, hora local): hoy o mañana; ayer solo para corregirlo.'),
  headline: string({ min: 1, max: 90, description: 'Titular para la pantalla de bloqueo, sin emojis: "Dormiste 7 h 20\' · Hoy rodaje suave 50\' a las 7:30".' }),
  script: string({
    min: 200,
    max: 2000,
    description:
      'Guion que la app lee en voz alta (110-200 palabras): saludo con su nombre, sueño y recuperación, cómo fue ayer frente al plan, la sesión de hoy con su porqué, UNA cifra que mande y UNA sensación, y el foco. Escrito para ser escuchado: sin markdown, listas, paréntesis, siglas ni abreviaturas; números y unidades como se dicen ("ciento cuarenta y cinco pulsaciones", "a cinco minutos y ocho segundos el kilómetro", "zona dos", "a las siete y media").',
  }),
  focus: string({ max: 140, description: 'Foco del día en una frase para la pantalla (aquí sí cifras: "Bloques a 4:25-4:35 /km, RPE 6-7").' }),
  sleep_verdict: optional(enumOf(SLEEP_VERDICTS, 'great, good, fair, poor o unknown (sin datos de sueño).')),
  sleep_summary: optional(string({ max: 200, description: 'Una frase sobre la noche con cifras ("7 h 20 min, VFC 58 ms, en tu media"), o "" sin datos.' })),
});

export const saveBriefingTool: RegisteredTool = defineTool({
  name: 'save_briefing',
  title: 'Guardar el informe de la mañana',
  description: [
    'Guarda el informe de la mañana del usuario ("Informe de hoy" en la pestaña Hoy): la app lo muestra y lo lee en voz alta con la voz del coach, en lugar del que generaría su IA gratuita.',
    'Prepáralo con get_planning_context (sesiones de hoy con su prescripción y coaching, planVsDone de ayer, métricas del reloj y check-ins, imprevistos, quedadas) y, si hay conector de Garmin o COROS, el sueño de anoche.',
    'Tono: cercano y humano pero técnico; cada cosa con su porqué. Usa solo datos reales: no inventes cifras ni sesiones. Sobrescribe el informe de ese día si ya existía.',
  ].join(' '),
  input,
  annotations: { title: 'Guardar el informe de la mañana', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (args, ctx) => {
    if (!ctx.briefings) return toolError('El informe de la mañana no está disponible en este servidor.');
    const profile = await ctx.store.getProfile(ctx.userId);
    const today = todayIn(profile?.timezone ?? DEFAULT_TZ, ctx.now());
    if (args.date < addDays(today, -WINDOW_DAYS) || args.date > addDays(today, WINDOW_DAYS)) {
      throw new ToolInputError(`Solo puedo guardar el informe de ayer, hoy o mañana (hoy es ${today}).`);
    }
    // Keep the watch's sleep snapshot if the in-app briefing already stored one for that day.
    const existing = await ctx.briefings.getBriefing(ctx.userId, args.date);
    const stored = await ctx.briefings.upsertBriefing(ctx.userId, {
      date: args.date,
      headline: args.headline.trim(),
      sleepVerdict: args.sleep_verdict ?? 'unknown',
      sleepSummary: (args.sleep_summary ?? '').trim(),
      script: args.script.trim(),
      focus: args.focus.trim(),
      sleep: existing?.sleep ?? null,
      model: CLAUDE_BRIEFING_MODEL,
      createdAt: ctx.now().toISOString(),
    });
    return toolOk({
      saved: true,
      date: stored.date,
      headline: stored.headline,
      next: stored.date === today ? 'El usuario lo verá al abrir Hoy (si ya lo tenía abierto, al volver a la app).' : 'Lo verá ese día al abrir Hoy.',
    });
  },
});
