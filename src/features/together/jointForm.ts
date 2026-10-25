/**
 * Quedada form: route params parsing, validation and conversion to a draft.
 * Pure — the screen only wires state and mutations.
 */
import { INTENSITIES, SPORTS, type Intensity, type ISODate, type ISOTime, type JointSessionDraft, type Sport, type UUID } from '@/domain/types';

import type { JointPrefill, Opportunity, Slot } from './types';

export const JOINT_LIMITS = {
  titleMax: 120,
  locationMax: 200,
  notesMax: 2000,
  minDuration: 15,
  maxDuration: 480,
  durationStep: 15,
  defaultDuration: 60,
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

/** Parses `/joint/new` search params defensively (anything invalid is dropped). */
export function parseJointParams(raw: RawParams): JointPrefill {
  const date = first(raw, 'date');
  const sport = first(raw, 'sport');
  const startTime = first(raw, 'startTime');
  const duration = Number(first(raw, 'durationMin'));
  const title = first(raw, 'title')?.trim();
  return {
    friendId: first(raw, 'friendId'),
    date: date && DATE_RE.test(date) ? date : undefined,
    sport: isSport(sport) && sport !== 'rest' ? sport : undefined,
    startTime: startTime && TIME_RE.test(startTime) ? startTime : undefined,
    durationMin: Number.isFinite(duration) && duration > 0 ? clampDuration(duration) : undefined,
    fromWorkoutId: first(raw, 'fromWorkoutId'),
    title: title ? title.slice(0, JOINT_LIMITS.titleMax) : undefined,
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

export function initialForm(prefill: JointPrefill, today: ISODate, acceptedFriendIds: readonly UUID[]): JointForm {
  const sport = prefill.sport ?? 'run';
  const friendOk = prefill.friendId && acceptedFriendIds.includes(prefill.friendId);
  const fallbackFriend = acceptedFriendIds.length === 1 ? acceptedFriendIds[0] : undefined;
  const invitee = friendOk ? prefill.friendId : fallbackFriend;
  return {
    inviteeIds: invitee ? [invitee] : [],
    sport,
    title: prefill.title ?? defaultTitle(sport),
    date: prefill.date && prefill.date >= today ? prefill.date : today,
    time: prefill.startTime ?? '',
    durationMin: prefill.durationMin ?? JOINT_LIMITS.defaultDuration,
    intensity: 'endurance',
    location: '',
    notes: '',
    fromWorkoutId: prefill.fromWorkoutId ?? null,
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
  if (form.inviteeIds.length === 0) return 'Elige al menos un amigo para invitar.';
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
  };
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

export function prefillFromSlot(slot: Slot, friendId: UUID): JointPrefill {
  return {
    friendId,
    date: slot.date,
    startTime: slot.start,
    durationMin: clampDuration(Math.min(slot.minutes, JOINT_LIMITS.defaultDuration)),
  };
}
