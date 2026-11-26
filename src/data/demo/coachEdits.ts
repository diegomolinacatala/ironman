/**
 * Plan edits the rules coach (no AI) understands in the chat, so asking to
 * change the plan works even when the AI coach is off, out of quota or fails:
 * - "mueve el rodaje del martes al jueves", "pasa las series al sábado",
 *   "pon la natación el jueves por la mañana" → move (with a time of day)
 * - "quita / borra el entreno de mañana" → delete
 * - "cambia las series del jueves por un rodaje suave" → update (easy session
 *   with the athlete's targets, `easyPatch`)
 * - "hoy no puedo (entrenar)" → key sessions re-placed (`replanMissed`), the
 *   easy ones dropped
 * - "tengo pádel el jueves (a las 19)" → `replanForEvent` with that imprevisto
 * - situations the athlete tells (a dinner, exams, a trip, no pool, little
 *   time, a softer week, more of one sport, tired today) → `coachSituations`
 * Days are resolved inside the editable window today..today+6 (hoy, mañana,
 * pasado mañana, lunes…domingo); a weekday asked as the destination of a move
 * is the one after the session ("pasa la bici del sábado al domingo"). A
 * request the coach understands but cannot map to one session gets an
 * explanation instead of a proposal. Pure.
 */
import { addDays, diffDays, weekdayOf } from '@/domain/dates';
import { easyPatch } from '@/domain/replanCore';
import { replanForEvent, replanMissed } from '@/domain/replanner';
import type { ISODate, Intensity, LifeEvent, LifeEventKind, PlanChange } from '@/domain/types';

import { situationEdit } from './coachSituations';
import {
  dateOfWord,
  dayLabel,
  dayRefs,
  editable,
  findSession,
  isWeekdayWord,
  nextOfSport,
  notFound,
  plain,
  quoted,
  sportIn,
  timeIn,
  timeOfDay,
  type EditContext,
  type EditResult,
} from './coachWords';

export { dayLabel, dayRefs, sportIn, type EditContext, type EditResult } from './coachWords';

const TITLE_MAX = 120;
const DEFAULT_EVENT_MIN = 90;
/** A weekday asked as a destination this many days before the session means the one after it. */
const FORWARD_MOVE_MIN_DAYS = 4;

// ---------------------------------------------------------------------------
// Intents
// ---------------------------------------------------------------------------

const OTHER_SPORT_RE = /\b(?:tengo|juego|jugare|jugar|voy a jugar|hay)\b.*?\b(padel|tenis|futbol|futbito|partido|baloncesto)\b/;
const CANT_RE = /\bno\s+(?:puedo|podre|voy a poder|me da tiempo|llego)\b/;
const DELETE_RE = /\b(?:quita|quitame|quitar|quitalo|quitala|borra|borrame|borrar|borralo|borrala|elimina|eliminame|eliminar|eliminalo|cancela|cancelar|cancelalo|anula|anular|saltate)\b/;
const REPLACE_RE = /\b(?:cambia|cambiame|cambiar|sustituye|sustituyeme|reemplaza)\b(.+?)\bpor\b(.+)/;
const MOVE_RE = /\b(?:mueve|mueveme|mover|muevela|muevelo|pasa|pasame|pasala|pasalo|lleva|llevame|traslada|cambia|cambiame|cambiala|cambialo|adelanta|retrasa|pon|ponme|ponla|ponlo)\b/;
const RECOVERY_RE = /recuperaci|muy suave|\bz1\b|regenerativ/;
const EASY_RE = /suave|tranquil|facil|\bz2\b|liger|rodaje|relajad/;
const HARD_RE = /series|calidad|intens|fuerte|umbral|tempo|\bz[345]\b/;
const MINUTES_RE = /(\d{2,3})\s*(?:min|minutos|')/;

function eventKind(word: string): LifeEventKind {
  if (word === 'padel' || word === 'tenis') return 'padel';
  if (word === 'futbol' || word === 'futbito' || word === 'partido') return 'football';
  return 'other_sport';
}

const EVENT_TITLES: Record<string, string> = { padel: 'Pádel', tenis: 'Tenis', futbol: 'Fútbol', futbito: 'Fútbol', partido: 'Partido', baloncesto: 'Baloncesto' };

function otherSport(text: string, ctx: EditContext): EditResult | null {
  const m = OTHER_SPORT_RE.exec(text);
  const word = m?.[1];
  if (!word) return null;
  const date = dayRefs(text, ctx.today)[0]?.date ?? null;
  if (!date) return null;
  const startTime = timeIn(text);
  const event: LifeEvent = {
    id: 'chat-event',
    userId: ctx.replanInput.profile.id,
    kind: eventKind(word),
    title: EVENT_TITLES[word] ?? 'Otro deporte',
    startDate: date,
    endDate: date,
    startTime,
    durationMin: startTime ? DEFAULT_EVENT_MIN : null,
    severity: 2,
    bodyArea: null,
    notes: null,
    createdAt: `${ctx.today}T00:00:00.000Z`,
  };
  const result = replanForEvent({ ...ctx.replanInput, today: ctx.today, weekWorkouts: [...ctx.workouts], event });
  // Logged as an imprevisto too, so the match counts in the week's load.
  const logEvent = { kind: event.kind, title: event.title, startDate: date, endDate: date, startTime, durationMin: event.durationMin, severity: 2 as const };
  return { changes: result.changes, summary: result.summary, logEvent };
}

function cantTrain(text: string, ctx: EditContext): EditResult | null {
  if (!CANT_RE.test(text)) return null;
  const date = dayRefs(text, ctx.today)[0]?.date ?? ctx.today;
  const label = dayLabel(date, ctx.today);
  const sessions = editable(ctx).filter((w) => w.date === date);
  if (sessions.length === 0) return { changes: [], summary: `No tienes nada planificado ${label}: no hace falta cambiar nada.` };
  // The day is lost: treat its sessions as missed from the next day on (key ones move or shrink).
  const missed = replanMissed({ ...ctx.replanInput, today: addDays(date, 1), weekWorkouts: [...ctx.workouts], missed: sessions });
  const touched = new Set(missed.changes.flatMap((c) => (c.op === 'add' ? [] : [c.workoutId])));
  const drops: PlanChange[] = sessions
    .filter((w) => !touched.has(w.id) && !w.jointSessionId)
    .map((w) => ({ op: 'delete', workoutId: w.id, reason: `${label[0]!.toUpperCase()}${label.slice(1)} no puedes entrenar: ${quoted(w)} no hace falta recuperarla.` }));
  const quedadas = sessions.filter((w) => w.jointSessionId && !touched.has(w.id));
  const changes = [...missed.changes, ...drops];
  const notes = quedadas.map((w) => `${quoted(w)} es una quedada: avisa a tu compañero desde Juntos.`);
  const head = changes.length > 0 ? `Vale, ${label} no entrenas: recoloco lo importante y quito lo que no hace falta recuperar.` : `Vale, ${label} no entrenas.`;
  return { changes, summary: [head, ...notes].join(' ') };
}

function deleteSession(text: string, ctx: EditContext): EditResult | null {
  if (!DELETE_RE.test(text)) return null;
  const date = dayRefs(text, ctx.today)[0]?.date ?? null;
  const target = findSession(ctx, text, date);
  if (!target) return notFound('ese entreno', date, ctx);
  const warning = target.isKey ? ' Era una sesión clave: si prefieres moverla, dime «mueve… al jueves».' : '';
  return {
    changes: [{ op: 'delete', workoutId: target.id, reason: `Me pides quitar ${quoted(target)} (${dayLabel(target.date, ctx.today)}).` }],
    summary: `Te quito ${quoted(target)} de ${dayLabel(target.date, ctx.today)}.${warning}`,
  };
}

function replaceIntensity(text: string): Intensity | null {
  if (RECOVERY_RE.test(text)) return 'recovery';
  if (HARD_RE.test(text)) return null;
  return EASY_RE.test(text) || sportIn(text) ? 'endurance' : null;
}

function replaceSession(text: string, ctx: EditContext): EditResult | null {
  const m = REPLACE_RE.exec(text);
  if (!m) return null;
  const [, from = '', to = ''] = m;
  const intensity = replaceIntensity(to);
  if (!intensity) return null;
  const date = dayRefs(from, ctx.today)[0]?.date ?? dayRefs(text, ctx.today)[0]?.date ?? null;
  const target = findSession(ctx, from, date);
  if (!target) return notFound('esa sesión', date, ctx);
  const minutes = MINUTES_RE.exec(to);
  const durationMin = minutes ? Number(minutes[1]) : target.durationMin;
  const sport = sportIn(to) ?? undefined;
  const patch = easyPatch(target, { durationMin, intensity, ...(sport ? { sport } : {}) }, { thresholds: ctx.replanInput.profile.thresholds });
  const title = (patch.title ?? (intensity === 'recovery' ? 'Sesión de recuperación' : 'Sesión suave')).slice(0, TITLE_MAX);
  return {
    changes: [{ op: 'update', workoutId: target.id, patch: { ...patch, title, isKey: false }, reason: `Cambias ${quoted(target)} por ${title.toLowerCase()}.` }],
    summary: `Cambio ${quoted(target)} de ${dayLabel(target.date, ctx.today)} por «${title}».`,
  };
}

/** "Pasa la bici del sábado al domingo": a weekday well before the session means the one after it. */
function destinationFor(word: string, date: ISODate, sessionDate: ISODate, today: ISODate): ISODate {
  if (!isWeekdayWord(word) || date >= sessionDate || diffDays(sessionDate, date) < FORWARD_MOVE_MIN_DAYS) return date;
  return dateOfWord(word, today, addDays(sessionDate, 1)) ?? date;
}

/** "a las 7", "por la mañana"… said after the destination day ("el jueves por la mañana"). */
function hourWords(text: string, destIndex: number): string {
  return text.slice(destIndex);
}

function moveSession(text: string, ctx: EditContext): EditResult | null {
  if (!MOVE_RE.test(text)) return null;
  const refs = dayRefs(text, ctx.today);
  const from = refs.find((r) => r.source) ?? (refs.length >= 2 ? refs[0] : undefined);
  const dest = refs.find((r) => r.destination) ?? (refs.length >= 2 ? refs[refs.length - 1] : refs.find((r) => !r.source));
  if (!dest || dest === from) return null;
  const source = from?.date ?? null;
  const words = text.slice(0, dest.index) || text;
  const toStartTime = timeOfDay(hourWords(text, dest.index));
  const sport = sportIn(words);
  // "Pon la natación el jueves por la mañana" with a swim already that day: a time change.
  const sameDay = !source && toStartTime && sport ? editable(ctx).find((w) => w.date === dest.date && w.sport === sport) : undefined;
  // Several sessions of the sport and no day saying which: the next one that is not already there.
  const target = sameDay ?? findSession(ctx, words, source) ?? (source ? null : nextOfSport(ctx, words, dest.date));
  if (!target) return notFound('ese entreno', source, ctx);
  const toDate = destinationFor(dest.word, dest.date, target.date, ctx.today);
  const when = `${dayLabel(toDate, ctx.today)}${toStartTime ? ` a las ${toStartTime}` : ''}`;
  if (target.date === toDate && (!toStartTime || toStartTime === target.startTime)) {
    return { changes: [], summary: `${quoted(target)} ya está ${dayLabel(toDate, ctx.today)}.` };
  }
  const busy = ctx.workouts.filter((w) => w.status === 'planned' && w.sport !== 'rest' && w.date === toDate && w.id !== target.id);
  const restDay = ctx.replanInput.profile.availability.restDay;
  const notes = [
    busy.length > 0 ? `Ojo: ${dayLabel(toDate, ctx.today)} ya tienes ${busy.map(quoted).join(' y ')}.` : '',
    restDay !== null && weekdayOf(toDate) === restDay ? 'Es tu día de descanso: si puedes, busca otro.' : '',
    target.jointSessionId ? 'Es una quedada: avisa a tu compañero desde Juntos.' : '',
  ].filter(Boolean);
  const move: PlanChange = {
    op: 'move',
    workoutId: target.id,
    toDate,
    ...(toStartTime ? { toStartTime } : {}),
    reason: `Me pides pasar ${quoted(target)} de ${dayLabel(target.date, ctx.today)} a ${when}.`,
  };
  return { changes: [move], summary: [`Paso ${quoted(target)} de ${dayLabel(target.date, ctx.today)} a ${when}.`, ...notes].join(' ') };
}

/** A move with an explicit destination ("…mueve la sesión al jueves"): the athlete said where, so it wins. */
function explicitMove(text: string, ctx: EditContext): boolean {
  return MOVE_RE.test(text) && dayRefs(text, ctx.today).some((r) => r.destination);
}

/**
 * The plan edit asked for in a chat message: a result with changes (a
 * proposal), a result without changes (explained), or null when the message
 * asks for no edit. `injury` skips the situations (the injury advice comes
 * first); explicit edits still work. Order: a match, then what the athlete
 * tells (unless a move says where), explicit edits, "no puedo", and the softer
 * requests (a softer week, more of a sport, tired today).
 */
export function chatEdit(message: string, ctx: EditContext, opts: { injury?: boolean } = {}): EditResult | null {
  const text = plain(message);
  if (!text.trim()) return null;
  const explicit = [replaceSession, deleteSession, moveSession];
  if (opts.injury) {
    for (const handler of explicit) {
      const result = handler(text, ctx);
      if (result) return result;
    }
    return null;
  }
  const told = explicitMove(text, ctx) ? null : situationEdit(text, ctx, 'told');
  const handlers = [otherSport, () => told, ...explicit, cantTrain, (t: string, c: EditContext) => situationEdit(t, c, 'asked')];
  for (const handler of handlers) {
    const result = handler(text, ctx);
    if (result) return result;
  }
  return null;
}
