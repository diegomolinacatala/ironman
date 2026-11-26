/**
 * «Tu semana» → «Entrenar con gente» (pure, app only): the planner's new sessions are fitted to
 * the friends' common free slots (Juntos › Huecos, `together.commonSlots`), and each one that
 * lands in a friend's slot says so («Coincides con Ana: proponle quedada»). Nothing is sent:
 * the athlete proposes the quedada from Juntos or the session.
 *
 * - 'together': a session without time, or whose time misses every slot, takes the earliest
 *   common slot of that day that holds it (never overlapping another new session).
 * - 'mix': only sessions without a time move into a slot; the rest are only named.
 * - 'flexible' (cuando mejor me vaya): nothing changes.
 * Only the same day: moving sessions across days is the planner's job (hard rules).
 */
import { minutesToTime, timeToMinutes } from './dates';
import type { Slot } from './together';
import type { ISODate, PlanChange, Sport, UUID, WeekPriority, WorkoutDraft } from './types';

export interface FriendSlots {
  friendId: UUID;
  /** First name for the copy ("Ana"). */
  name: string;
  slots: Slot[];
}

export interface SocialLayerInput {
  changes: readonly PlanChange[];
  priority: WeekPriority;
  friends: readonly FriendSlots[];
}

export interface SocialLayerResult {
  changes: PlanChange[];
  /** One sentence for the proposal summary (null for 'flexible'). */
  note: string | null;
  /** New sessions that fall in a friend's common slot. */
  matched: number;
}

const SOCIAL_SPORTS: readonly Sport[] = ['bike', 'run', 'swim', 'brick'];

/** "Ana", "Ana y Luis", "Ana, Luis y Marta". */
export function namesList(names: readonly string[]): string {
  const unique = [...new Set(names)];
  if (unique.length <= 1) return unique[0] ?? '';
  return `${unique.slice(0, -1).join(', ')} y ${unique[unique.length - 1]}`;
}

interface Range {
  start: number;
  end: number;
}

function slotRange(s: Slot): Range {
  return { start: timeToMinutes(s.start), end: timeToMinutes(s.end) };
}

function holds(slot: Range, start: number, minutes: number): boolean {
  return Number.isFinite(slot.start) && start >= slot.start && start + minutes <= slot.end;
}

function friendsHolding(friends: readonly FriendSlots[], date: ISODate, start: number, minutes: number): string[] {
  return friends.filter((f) => f.slots.some((s) => s.date === date && holds(slotRange(s), start, minutes))).map((f) => f.name);
}

function busyOf(changes: readonly PlanChange[], date: ISODate, except: number): Range[] {
  return changes.flatMap((c, i) => {
    if (i === except || c.op !== 'add' || c.workout.date !== date || !c.workout.startTime) return [];
    const start = timeToMinutes(c.workout.startTime);
    return Number.isFinite(start) ? [{ start, end: start + c.workout.durationMin }] : [];
  });
}

function overlaps(a: Range, list: readonly Range[]): boolean {
  return list.some((b) => a.start < b.end && b.start < a.end);
}

/** Earliest start inside a friend's slot of `date` that holds the session and misses the other new sessions. */
function slotStart(friends: readonly FriendSlots[], date: ISODate, minutes: number, busy: readonly Range[]): number | null {
  const starts = friends
    .flatMap((f) => f.slots.filter((s) => s.date === date).map(slotRange))
    .filter((r) => Number.isFinite(r.start) && r.end - r.start >= minutes)
    .map((r) => r.start)
    .sort((a, b) => a - b);
  return starts.find((start) => !overlaps({ start, end: start + minutes }, busy)) ?? null;
}

function social(w: WorkoutDraft): boolean {
  return SOCIAL_SPORTS.includes(w.sport) && w.intensity !== 'race';
}

function withFriends(reason: string, names: readonly string[]): string {
  return `${reason} Coincides con ${namesList(names)} en un hueco libre: proponle quedada.`.trim();
}

/** The planner's proposal fitted to the friends' common slots (see the module comment). */
export function socialLayer(input: SocialLayerInput): SocialLayerResult {
  if (input.priority === 'flexible') return { changes: [...input.changes], note: null, matched: 0 };
  const out: PlanChange[] = [...input.changes];
  const matchedNames: string[] = [];
  let matched = 0;
  out.forEach((change, i) => {
    if (change.op !== 'add' || !social(change.workout)) return;
    const w = change.workout;
    const own = w.startTime ? timeToMinutes(w.startTime) : Number.NaN;
    const atOwn = Number.isFinite(own) ? friendsHolding(input.friends, w.date, own, w.durationMin) : [];
    if (atOwn.length > 0) {
      out[i] = { ...change, reason: withFriends(change.reason, atOwn) };
      matched += 1;
      matchedNames.push(...atOwn);
      return;
    }
    const mayMove = input.priority === 'together' || !w.startTime;
    if (!mayMove) return;
    const start = slotStart(input.friends, w.date, w.durationMin, busyOf(out, w.date, i));
    if (start === null) return;
    const names = friendsHolding(input.friends, w.date, start, w.durationMin);
    out[i] = { ...change, workout: { ...w, startTime: minutesToTime(start) }, reason: withFriends(change.reason, names) };
    matched += 1;
    matchedNames.push(...names);
  });
  return { changes: out, note: socialNote(input, matched, matchedNames), matched };
}

function socialNote(input: SocialLayerInput, matched: number, names: readonly string[]): string {
  if (input.friends.length === 0) return 'Para entrenar con gente, añade a tus amigos en Juntos y cuadraremos los huecos.';
  if (matched === 0) return 'Esta semana no he encontrado huecos comunes con tus amigos para las sesiones nuevas.';
  const sessions = matched === 1 ? '1 sesión cae' : `${matched} sesiones caen`;
  return `Con gente: ${sessions} en huecos libres de ${namesList(names)}. Propón la quedada desde Juntos.`;
}
