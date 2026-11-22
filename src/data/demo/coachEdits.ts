/**
 * Plan edits the rules coach (no AI) understands in the chat, so asking to
 * change the plan works even when the AI coach is off, out of quota or fails:
 * - "mueve el rodaje del martes al jueves", "pasa las series al sábado" → move
 * - "quita / borra el entreno de mañana" → delete
 * - "cambia las series del jueves por un rodaje suave" → update (easy session
 *   with the athlete's targets, `easyPatch`)
 * - "hoy no puedo (entrenar)" → key sessions re-placed (`replanMissed`), the
 *   easy ones dropped
 * - "tengo pádel el jueves (a las 19)" → `replanForEvent` with that imprevisto
 * Days are resolved inside the editable window today..today+6 (hoy, mañana,
 * pasado mañana, lunes…domingo). A request the coach understands but cannot
 * map to one session gets an explanation instead of a proposal. Pure.
 */
import { addDays, formatDayMedium, weekdayOf } from '@/domain/dates';
import { easyPatch } from '@/domain/replanCore';
import { replanForEvent, replanMissed, type ReplanInput } from '@/domain/replanner';
import type { ISODate, ISOTime, Intensity, LifeEvent, LifeEventKind, PlanChange, Sport, Workout } from '@/domain/types';

export interface EditResult {
  changes: PlanChange[];
  summary: string;
}

export interface EditContext {
  today: ISODate;
  /** Workouts of today..today+6 at least (planned and done). */
  workouts: readonly Workout[];
  /** Base re-planner input (profile, busy blocks, events, quedadas, races, week plan). */
  replanInput: ReplanInput;
}

/** Editable window (same as the re-planner): today..today+6. */
const WINDOW_DAYS = 7;
const TITLE_MAX = 120;
const DEFAULT_EVENT_MIN = 90;

const WEEKDAYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

/** Lowercase without accents ("miércoles" → "miercoles"), so the patterns stay simple. */
function plain(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

interface DayRef {
  date: ISODate;
  /** Index in the (plain) message. */
  index: number;
  /** Preceded by "al", "a", "para" (a destination). */
  destination: boolean;
  /** Preceded by "del", "de" (where the session is now). */
  source: boolean;
}

const DAY_RE = /\b(pasado manana|hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/g;

function dateOfWord(word: string, today: ISODate): ISODate | null {
  if (word === 'hoy') return today;
  if (word === 'manana') return addDays(today, 1);
  if (word === 'pasado manana') return addDays(today, 2);
  const weekday = WEEKDAYS.indexOf(word);
  if (weekday < 0) return null;
  for (let i = 0; i < WINDOW_DAYS; i += 1) {
    const d = addDays(today, i);
    if (weekdayOf(d) === weekday) return d;
  }
  return null;
}

/** Day references in order ("por la mañana" / "esta mañana" are times of day, not tomorrow). */
export function dayRefs(message: string, today: ISODate): DayRef[] {
  const text = plain(message);
  const refs: DayRef[] = [];
  for (const match of text.matchAll(DAY_RE)) {
    const word = match[1] ?? '';
    const index = match.index ?? 0;
    const before = text.slice(Math.max(0, index - 10), index);
    if (word === 'manana' && /(?:la|esta)\s+$/.test(before)) continue;
    const date = dateOfWord(word, today);
    if (date) refs.push({ date, index, destination: /(?:\bal|\ba|\bpara(?: el)?|\bhasta el)\s+$/.test(before), source: /\bdel?\s+$/.test(before) });
  }
  return refs;
}

export function dayLabel(date: ISODate, today: ISODate): string {
  if (date === today) return 'hoy';
  if (date === addDays(today, 1)) return 'mañana';
  return `el ${formatDayMedium(date)}`;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

const SPORT_WORDS: readonly [Sport, RegExp][] = [
  ['brick', /\bbrick|transicion/],
  ['swim', /\bnata|\bnadar|piscina|\bnado\b/],
  ['bike', /\bbici|rodillo|ciclismo/],
  ['run', /rodaje|correr|\bcarrera\b|tirada|footing|trote|\brun\b/],
  ['strength', /fuerza|gimnasio|\bgym\b|pesas/],
  ['mobility', /movilidad|estiramientos|\byoga\b/],
];

export function sportIn(text: string): Sport | null {
  const p = plain(text);
  return SPORT_WORDS.find(([, re]) => re.test(p))?.[0] ?? null;
}

/** Words of 5+ letters of the message that appear in the title ("series", "umbral", "tirada"…). */
function titleScore(w: Workout, text: string): number {
  const title = plain(w.title);
  return plain(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 5 && title.includes(word)).length;
}

function editable(ctx: EditContext): Workout[] {
  const last = addDays(ctx.today, WINDOW_DAYS - 1);
  return ctx.workouts
    .filter((w) => w.status === 'planned' && w.sport !== 'rest' && w.date >= ctx.today && w.date <= last)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? ''));
}

/** The one session the words point to (day, sport, title words), or null when none or ambiguous. */
function findSession(ctx: EditContext, text: string, date: ISODate | null): Workout | null {
  let candidates = editable(ctx);
  if (date) candidates = candidates.filter((w) => w.date === date);
  const sport = sportIn(text);
  if (sport) {
    const bySport = candidates.filter((w) => w.sport === sport || (sport === 'run' && w.sport === 'brick'));
    if (bySport.length > 0) candidates = bySport;
    else if (!date) return null;
  }
  if (candidates.length <= 1) return candidates[0] ?? null;
  const scored = candidates.map((w) => ({ w, score: titleScore(w, text) }));
  const best = Math.max(...scored.map((s) => s.score));
  const top = scored.filter((s) => s.score === best);
  return best > 0 && top.length === 1 ? top[0]!.w : null;
}

function notFound(what: string, date: ISODate | null, today: ISODate): EditResult {
  const when = date ? ` ${dayLabel(date, today)}` : ' en los próximos 7 días';
  return {
    changes: [],
    summary: `No encuentro ${what}${when} que pueda cambiar. Dime el día y el deporte (por ejemplo, «mueve el rodaje del martes al jueves») y te lo preparo.`,
  };
}

const quoted = (w: Workout): string => `«${w.title}»`;

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
const TIME_RE = /\ba las (\d{1,2})(?:[:.](\d{2}))?/;

function eventKind(word: string): LifeEventKind {
  if (word === 'padel' || word === 'tenis') return 'padel';
  if (word === 'futbol' || word === 'futbito' || word === 'partido') return 'football';
  return 'other_sport';
}

const EVENT_TITLES: Record<string, string> = { padel: 'Pádel', tenis: 'Tenis', futbol: 'Fútbol', futbito: 'Fútbol', partido: 'Partido', baloncesto: 'Baloncesto' };

function timeIn(text: string): ISOTime | null {
  const m = TIME_RE.exec(text);
  if (!m) return null;
  let hour = Number(m[1]);
  // "a las 7 de la tarde", "a las 8" in the evening context of a match.
  if (hour < 12 && /tarde|noche/.test(text)) hour += 12;
  if (hour > 23) return null;
  return `${String(hour).padStart(2, '0')}:${m[2] ?? '00'}`;
}

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
  const tip = 'Apúntalo también como imprevisto para que cuente en tu carga.';
  return { changes: result.changes, summary: `${result.summary} ${tip}` };
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
  if (!target) return notFound('ese entreno', date, ctx.today);
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
  if (!target) return notFound('esa sesión', date, ctx.today);
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

function moveSession(text: string, ctx: EditContext): EditResult | null {
  if (!MOVE_RE.test(text)) return null;
  const refs = dayRefs(text, ctx.today);
  const from = refs.find((r) => r.source) ?? (refs.length >= 2 ? refs[0] : undefined);
  const dest = refs.find((r) => r.destination) ?? (refs.length >= 2 ? refs[refs.length - 1] : refs.find((r) => !r.source));
  if (!dest || dest === from) return null;
  const source = from?.date ?? null;
  const target = findSession(ctx, text.slice(0, dest.index) || text, source);
  if (!target) return notFound('ese entreno', source, ctx.today);
  if (target.date === dest.date) return { changes: [], summary: `${quoted(target)} ya está ${dayLabel(dest.date, ctx.today)}.` };
  const busy = editable(ctx).filter((w) => w.date === dest.date && w.id !== target.id);
  const restDay = ctx.replanInput.profile.availability.restDay;
  const notes = [
    busy.length > 0 ? `Ojo: ${dayLabel(dest.date, ctx.today)} ya tienes ${busy.map(quoted).join(' y ')}.` : '',
    restDay !== null && weekdayOf(dest.date) === restDay ? 'Es tu día de descanso: si puedes, busca otro.' : '',
    target.jointSessionId ? 'Es una quedada: avisa a tu compañero desde Juntos.' : '',
  ].filter(Boolean);
  return {
    changes: [{ op: 'move', workoutId: target.id, toDate: dest.date, reason: `Me pides pasar ${quoted(target)} de ${dayLabel(target.date, ctx.today)} a ${dayLabel(dest.date, ctx.today)}.` }],
    summary: [`Paso ${quoted(target)} de ${dayLabel(target.date, ctx.today)} a ${dayLabel(dest.date, ctx.today)}.`, ...notes].join(' '),
  };
}

/**
 * The plan edit asked for in a chat message: a result with changes (a
 * proposal), a result without changes (explained), or null when the message
 * asks for no edit. `injury` skips the "no puedo" / other-sport handling (the
 * injury advice comes first); explicit edits still work.
 */
export function chatEdit(message: string, ctx: EditContext, opts: { injury?: boolean } = {}): EditResult | null {
  const text = plain(message);
  if (!text.trim()) return null;
  const explicit = [replaceSession, deleteSession, moveSession];
  const situational = opts.injury ? [] : [otherSport, cantTrain];
  for (const handler of [...situational.slice(0, 1), ...explicit, ...situational.slice(1)]) {
    const result = handler(text, ctx);
    if (result) return result;
  }
  return null;
}
