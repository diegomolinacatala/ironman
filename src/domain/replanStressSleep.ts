/**
 * Eases the next days when stress is costing the athlete sleep
 * (`stressSleep.ts`): 2 days (3 when the signal is high or in an exam period)
 * from today get less intensity and less volume. The key session survives when
 * possible: the one marked as key, else the first quality or long session (a
 * little shorter when the signal is high); the other quality and long sessions
 * become easy and the rest is shortened. Quedadas are left as agreed. The
 * result is a proposal the athlete reviews. Pure.
 */
import { addDays } from './dates';
import {
  downgrade,
  finish,
  isJoint,
  isKeyish,
  isProtected,
  makeCtx,
  note,
  pending,
  shorten,
  startPlan,
  type ReplanInput,
  type ReplanResult,
} from './replanCore';
import type { StressSleepSignal } from './stressSleep';
import type { Workout } from './types';

/** Volume kept on the eased days. [H] */
export const STRESS_SLEEP_EASE = { moderate: 0.8, high: 0.7, keyHigh: 0.85, easyMaxMin: 60 } as const;

function keySessionOf(sessions: readonly Workout[]): Workout | null {
  const keyish = sessions.filter((w) => !isJoint(w) && (w.isKey || isKeyish(w)));
  return keyish.find((w) => w.isKey) ?? keyish[0] ?? null;
}

export function replanForStressSleep(input: ReplanInput & { signal: StressSleepSignal }): ReplanResult {
  const { signal } = input;
  const ctx = makeCtx(input);
  const last = addDays(ctx.today, Math.max(1, signal.easeDays) - 1);
  const inWindow = (w: Workout) => w.date >= ctx.today && w.date <= last;
  const high = signal.level === 'high';
  const factor = high ? STRESS_SLEEP_EASE.high : STRESS_SLEEP_EASE.moderate;
  const label = signal.exam ? 'Exámenes, estrés y peor sueño' : 'Estrés y peor sueño';
  let plan = startPlan(input);
  const sessions = pending(plan, ctx, inWindow);
  const key = keySessionOf(sessions);

  for (const w of sessions) {
    if (w.id === key?.id || isJoint(w) || !isKeyish(w)) continue;
    plan = downgrade(
      plan,
      ctx,
      w,
      { sport: w.sport === 'brick' ? 'bike' : w.sport, durationMin: Math.min(w.durationMin * factor, STRESS_SLEEP_EASE.easyMaxMin) },
      `${label}: estos días esta sesión pasa a suave`,
    );
  }
  for (const w of pending(plan, ctx, inWindow)) {
    if (w.id === key?.id || isProtected(w)) continue;
    plan = shorten(plan, ctx, w, factor, `${label}: recorto un ${Math.round((1 - factor) * 100)} % para que descanses más`);
  }
  if (key) {
    if (high) plan = shorten(plan, ctx, key, STRESS_SLEEP_EASE.keyHigh, `${label}: mantengo «${key.title}», algo más corta`);
    plan = note(plan, `Mantengo «${key.title}»: hazla sin apurar y, si te notas fundido, cambia a su versión suave.`);
  }
  plan = note(plan, 'Lo que más ayuda ahora: acostarte antes y unos minutos de respiración lenta.');
  return finish(plan, `${signal.headline}.`, 'Tus próximos días ya son suaves: no hace falta cambiar nada. Lo que más ayuda ahora es acostarte antes.');
}
