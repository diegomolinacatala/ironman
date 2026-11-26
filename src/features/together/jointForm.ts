/**
 * Quedada form: route params parsing, validation and conversion to a draft.
 * Pure — the screen only wires state and mutations.
 */
import { addDays } from '@/domain/dates';
import {
  INTENSITIES,
  SPORTS,
  type Intensity,
  type ISODate,
  type ISOTime,
  type JointSession,
  type JointSessionDraft,
  type JointSessionPatch,
  type Sport,
  type UUID,
} from '@/domain/types';

import type { JointPrefill, Opportunity, Slot } from './types';

export const JOINT_LIMITS = {
  titleMax: 120,
  locationMax: 200,
  notesMax: 2000,
  minDuration: 15,
  maxDuration: 480,
  durationStep: 15,
  defaultDuration: 60,
  /** Friends one quedada can invite (MCP and RPC allow 10). */
  maxInvitees: 10,
} as const;

/** Sports that make sense for a joint session (no "rest"). */
export const JOINT_SPORTS: readonly Sport[] = SPORTS.filter((s) => s !== 'rest');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface JointForm {
  inviteeIds: UUID[];
  sport: Sport;
  title: string;
  date: ISODate;
  /** Raw text typed by the user ("18:30", "" = sin hora). */
  time: string;
  durationMin: number;
  intensity: Intensity;
  location: string;
  notes: string;
  fromWorkoutId: UUID | null;
  /** Open to every friend: anyone can join, no invitee needed. */
  isOpen: boolean;
}

type RawParams = Record<string, string | string[] | undefined>;

function first(raw: RawParams, key: string): string | undefined {
  const value = raw[key];
  const single = Array.isArray(value) ? value[0] : value;
  return single && single.length > 0 ? single : undefined;
}

function isSport(value: string | undefined): value is Sport {
  return value !== undefined && (SPORTS as readonly string[]).includes(value);
}

export function clampDuration(value: number): number {
  if (!Number.isFinite(value)) return JOINT_LIMITS.defaultDuration;
  const stepped = Math.round(value / 5) * 5;
  return Math.min(JOINT_LIMITS.maxDuration, Math.max(JOINT_LIMITS.minDuration, stepped));
}

/** "a,b,c" → ['a', 'b', 'c'] (empty and repeated ids dropped, at most the 10 friends a quedada can invite). */
function idList(value: string | undefined): UUID[] | undefined {
  const ids = [...new Set((value ?? '').split(',').map((id) => id.trim()).filter((id) => id.length > 0))];
  return ids.length > 0 ? ids.slice(0, JOINT_LIMITS.maxInvitees) : undefined;
}

/** Parses `/joint/new` search params defensively (anything invalid is dropped). */
export function parseJointParams(raw: RawParams): JointPrefill {
  const date = first(raw, 'date');
  const sport = first(raw, 'sport');
  const startTime = first(raw, 'startTime');
  const duration = Number(first(raw, 'durationMin'));
  const title = first(raw, 'title')?.trim();
  const intensity = first(raw, 'intensity');
  const location = first(raw, 'location')?.trim();
  return {
    friendId: first(raw, 'friendId'),
    friendIds: idList(first(raw, 'friendIds')),
    date: date && DATE_RE.test(date) ? date : undefined,
    sport: isSport(sport) && sport !== 'rest' ? sport : undefined,
    startTime: startTime && TIME_RE.test(startTime) ? startTime : undefined,
    durationMin: Number.isFinite(duration) && duration > 0 ? clampDuration(duration) : undefined,
    fromWorkoutId: first(raw, 'fromWorkoutId'),
    title: title ? title.slice(0, JOINT_LIMITS.titleMax) : undefined,
    intensity: intensity && (INTENSITIES as readonly string[]).includes(intensity) ? (intensity as Intensity) : undefined,
    location: location ? location.slice(0, JOINT_LIMITS.locationMax) : undefined,
    open: first(raw, 'open') === '1' ? '1' : undefined,
  };
}

/** Default session title for a sport ("Rodaje juntos"). */
export function defaultTitle(sport: Sport): string {
  const names: Record<Sport, string> = {
    swim: 'Nado juntos',
    bike: 'Salida en bici',
    run: 'Rodaje juntos',
    brick: 'Transición juntos',
    strength: 'Gimnasio juntos',
    mobility: 'Movilidad juntos',
    other: 'Entreno juntos',
    rest: 'Entreno juntos',
  };
  return names[sport];
}

/** Who the form starts inviting: the prefilled friends who are still friends, else the only friend. */
function initialInvitees(prefill: JointPrefill, acceptedFriendIds: readonly UUID[]): UUID[] {
  const wanted = [...(prefill.friendIds ?? []), ...(prefill.friendId ? [prefill.friendId] : [])];
  const valid = [...new Set(wanted.filter((id) => acceptedFriendIds.includes(id)))];
  if (valid.length > 0) return valid;
  const onlyFriend = acceptedFriendIds.length === 1 ? acceptedFriendIds[0] : undefined;
  return onlyFriend ? [onlyFriend] : [];
}

export function initialForm(prefill: JointPrefill, today: ISODate, acceptedFriendIds: readonly UUID[]): JointForm {
  const sport = prefill.sport ?? 'run';
  return {
    inviteeIds: initialInvitees(prefill, acceptedFriendIds),
    sport,
    title: prefill.title ?? defaultTitle(sport),
    date: prefill.date && prefill.date >= today ? prefill.date : today,
    time: prefill.startTime ?? '',
    durationMin: prefill.durationMin ?? JOINT_LIMITS.defaultDuration,
    intensity: prefill.intensity ?? 'endurance',
    location: prefill.location ?? '',
    notes: '',
    fromWorkoutId: prefill.fromWorkoutId ?? null,
    isOpen: prefill.open === '1',
  };
}

/** Edit form of an existing quedada (organizer): invitees are not editable. */
export function formFromSession(session: JointSession): JointForm {
  return {
    inviteeIds: session.participants.filter((p) => p.userId !== session.organizerId).map((p) => p.userId),
    sport: session.sport,
    title: session.title,
    date: session.date,
    time: session.startTime ?? '',
    durationMin: session.durationMin,
    intensity: session.intensity,
    location: session.location ?? '',
    notes: session.notes ?? '',
    fromWorkoutId: null,
    isOpen: session.isOpen === true,
  };
}

/**
 * Normalises typed times: "9" → "09:00", "930" → "09:30", "18.30" → "18:30".
 * Returns null for empty input and 'invalid' when it cannot be parsed.
 */
export function normalizeTime(input: string): ISOTime | null | 'invalid' {
  const raw = input.trim().toLowerCase().replace(/[.,h]/g, ':').replace(/:$/, '');
  if (raw === '') return null;
  const match = /^(\d{1,2})(?::?(\d{2}))?$/.exec(raw);
  if (!match) return 'invalid';
  const hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  if (hours > 23 || minutes > 59) return 'invalid';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** First problem with the form, in Spanish, or null when it can be sent. */
export function validateJointForm(form: JointForm, today: ISODate): string | null {
  if (form.inviteeIds.length === 0 && !form.isOpen) return 'Elige al menos un amigo o ábrela a todos tus amigos.';
  if (form.title.trim().length === 0) return 'Ponle un título a la quedada.';
  if (form.title.trim().length > JOINT_LIMITS.titleMax) return 'El título es demasiado largo.';
  if (!DATE_RE.test(form.date)) return 'Elige un día.';
  if (form.date < today) return 'La quedada no puede ser en el pasado.';
  if (normalizeTime(form.time) === 'invalid') return 'La hora debe tener el formato 18:30.';
  if (form.durationMin < JOINT_LIMITS.minDuration || form.durationMin > JOINT_LIMITS.maxDuration) {
    return 'La duración debe estar entre 15 minutos y 8 horas.';
  }
  if (form.location.length > JOINT_LIMITS.locationMax) return 'El lugar es demasiado largo.';
  if (form.notes.length > JOINT_LIMITS.notesMax) return 'Las notas son demasiado largas.';
  if (!(INTENSITIES as readonly string[]).includes(form.intensity)) return 'Elige una intensidad.';
  return null;
}

export function toJointDraft(form: JointForm): JointSessionDraft {
  const time = normalizeTime(form.time);
  const location = form.location.trim();
  const notes = form.notes.trim();
  return {
    sport: form.sport,
    date: form.date,
    startTime: time === 'invalid' ? null : time,
    durationMin: clampDuration(form.durationMin),
    intensity: form.intensity,
    title: form.title.trim(),
    location: location.length > 0 ? location : null,
    notes: notes.length > 0 ? notes : null,
    inviteeIds: [...form.inviteeIds],
    fromWorkoutId: form.fromWorkoutId,
    isOpen: form.isOpen,
  };
}

/** Only the fields that differ from `session` (edit mode). */
export function toJointPatch(form: JointForm, session: JointSession): JointSessionPatch {
  const draft = toJointDraft(form);
  const patch: JointSessionPatch = {};
  if (draft.sport !== session.sport) patch.sport = draft.sport;
  if (draft.title !== session.title) patch.title = draft.title;
  if (draft.date !== session.date) patch.date = draft.date;
  if ((draft.startTime ?? null) !== session.startTime) patch.startTime = draft.startTime ?? null;
  if (draft.durationMin !== session.durationMin) patch.durationMin = draft.durationMin;
  if (draft.intensity !== session.intensity) patch.intensity = draft.intensity;
  if ((draft.location ?? null) !== session.location) patch.location = draft.location ?? null;
  if ((draft.notes ?? null) !== session.notes) patch.notes = draft.notes ?? null;
  if (draft.isOpen !== (session.isOpen === true)) patch.isOpen = draft.isOpen;
  return patch;
}

/** Route params for `/joint/new` (only defined values). */
export function jointNewParams(prefill: JointPrefill): Record<string, string> {
  const entries = Object.entries(prefill).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return Object.fromEntries(entries.map(([k, v]) => [k, String(v)]));
}

export function prefillFromOpportunity(opportunity: Opportunity, friendId: UUID): JointPrefill {
  return {
    friendId,
    date: opportunity.date,
    sport: opportunity.sport === 'rest' ? undefined : opportunity.sport,
    startTime: opportunity.start ?? undefined,
    durationMin: opportunity.durationMin > 0 ? clampDuration(opportunity.durationMin) : undefined,
    fromWorkoutId: opportunity.myWorkoutId ?? undefined,
    title: opportunity.title,
  };
}

/** «Repetir la semana que viene»: seven days later. */
export const REPEAT_AFTER_DAYS = 7;

/** A week after `date`; when that is already past, the same weekday from today on. */
export function nextWeekDate(date: ISODate, today: ISODate): ISODate {
  let next = addDays(date, REPEAT_AFTER_DAYS);
  while (next < today) next = addDays(next, REPEAT_AFTER_DAYS);
  return next;
}

/** I organised it or said yes, and it was not cancelled: I can propose it again. */
export function canRepeat(session: JointSession, myId: UUID | null): boolean {
  if (!myId || session.status === 'cancelled') return false;
  if (session.organizerId === myId) return true;
  return session.participants.some((p) => p.userId === myId && p.status === 'accepted');
}

/**
 * The new-quedada form for «Repetir la semana que viene»: same sport, title, start time,
 * duration, intensity, place and people (everyone but me who did not decline; the form keeps
 * only those who are still my friends), a week later. Notes are not copied: they are usually
 * about that one day. Open to all my friends only when I organised an open one.
 */
export function repeatPrefill(session: JointSession, myId: UUID | null, today: ISODate): JointPrefill {
  const friendIds = session.participants.filter((p) => p.userId !== myId && p.status !== 'declined').map((p) => p.userId);
  const location = session.location?.trim();
  return {
    ...(friendIds.length > 0 ? { friendIds: friendIds.slice(0, JOINT_LIMITS.maxInvitees) } : {}),
    date: nextWeekDate(session.date, today),
    ...(session.sport !== 'rest' ? { sport: session.sport } : {}),
    ...(session.startTime ? { startTime: session.startTime } : {}),
    durationMin: clampDuration(session.durationMin),
    title: session.title.slice(0, JOINT_LIMITS.titleMax),
    intensity: session.intensity,
    ...(location ? { location: location.slice(0, JOINT_LIMITS.locationMax) } : {}),
    ...(session.isOpen === true && session.organizerId === myId ? { open: '1' } : {}),
  };
}

export function prefillFromSlot(slot: Slot, friendId: UUID): JointPrefill {
  return {
    friendId,
    date: slot.date,
    startTime: slot.start,
    durationMin: clampDuration(Math.min(slot.minutes, JOINT_LIMITS.defaultDuration)),
  };
}
