/**
 * Persistence of "Añadir mis entrenos al calendario".
 *
 * - Per account (`deviceState` key `trainingCalendar`): on/off, calendar id/title, alarm,
 *   the workout → event mapping with the signature last written, last sync, profile zone.
 * - Device-wide (not personal): ids of the calendars we write to, so the busy-time reader
 *   never mistakes our own workouts for "ocupado" (`calendar.ts`), and of the ones this app
 *   CREATED — the only calendars it may ever delete.
 */
import { readJson, writeJson } from '@/lib/storage';

import { readUserJson, removeUserKey, userIdsWithKey, writeUserJson } from '../deviceState';

export const TRAINING_CALENDAR_TITLE = 'Road to Ironman';
/** Deep lime: the brand accent, dark enough to read in Calendar on both themes. */
export const TRAINING_CALENDAR_COLOR = '#9CC20F';
export const DEFAULT_ALARM_MINUTES = 30;
export const MAX_ALARM_MINUTES = 24 * 60;

const KNOWN_IDS_KEY = 'rti.trainingCalendar.ids';
const CREATED_IDS_KEY = 'rti.trainingCalendar.created';
const MAX_KNOWN_IDS = 10;

export interface EventLink {
  eventId: string;
  signature: string;
}

export interface TrainingCalendarSettings {
  enabled: boolean;
  calendarId: string | null;
  calendarTitle: string | null;
  /** We created `calendarId` (never true for a calendar we adopted): only then may it be deleted. */
  createdByApp: boolean;
  /** Alarm before each timed workout, minutes (0 = none). */
  alarmMinutes: number;
  /** workoutId → the event we wrote for it. */
  events: Readonly<Record<string, EventLink>>;
  lastSync: string | null;
  /** Last known profile time zone (used when a caller does not pass one). */
  timeZone: string | null;
}

export const DEFAULT_TRAINING_SETTINGS: TrainingCalendarSettings = {
  enabled: false,
  calendarId: null,
  calendarTitle: null,
  createdByApp: false,
  alarmMinutes: DEFAULT_ALARM_MINUTES,
  events: {},
  lastSync: null,
  timeZone: null,
};

export function clampAlarmMinutes(minutes: unknown): number {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return DEFAULT_ALARM_MINUTES;
  return Math.min(MAX_ALARM_MINUTES, Math.max(0, Math.round(minutes)));
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function sanitizeEvents(value: unknown): Record<string, EventLink> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([workoutId, link]) => {
      const record = link as Partial<EventLink> | null;
      return record && typeof record.eventId === 'string' && typeof record.signature === 'string'
        ? [[workoutId, { eventId: record.eventId, signature: record.signature }]]
        : [];
    }),
  );
}

/** Settings from storage (untrusted JSON) with safe defaults. */
export function sanitizeTrainingSettings(value: unknown): TrainingCalendarSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_TRAINING_SETTINGS;
  const raw = value as Record<string, unknown>;
  return {
    enabled: raw.enabled === true,
    calendarId: stringOrNull(raw.calendarId),
    calendarTitle: stringOrNull(raw.calendarTitle),
    createdByApp: raw.createdByApp === true,
    alarmMinutes: raw.alarmMinutes === undefined ? DEFAULT_ALARM_MINUTES : clampAlarmMinutes(raw.alarmMinutes),
    events: sanitizeEvents(raw.events),
    lastSync: stringOrNull(raw.lastSync),
    timeZone: stringOrNull(raw.timeZone),
  };
}

export async function readTrainingSettings(userId: string): Promise<TrainingCalendarSettings> {
  return sanitizeTrainingSettings(await readUserJson<unknown>('trainingCalendar', userId, null));
}

export async function writeTrainingSettings(userId: string, settings: TrainingCalendarSettings): Promise<void> {
  await writeUserJson('trainingCalendar', userId, settings);
}

/** Forgets this account's settings and mapping on the device (sign-out, account deletion). */
export async function removeTrainingSettings(userId: string): Promise<void> {
  await removeUserKey('trainingCalendar', userId);
}

/** Accounts with training-calendar state on this device. */
export function trainingSettingsUserIds(): Promise<string[]> {
  return userIdsWithKey('trainingCalendar');
}

async function readIds(key: string): Promise<string[]> {
  const value = await readJson<unknown>(key, []);
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

async function addId(key: string, id: string): Promise<void> {
  const ids = await readIds(key);
  if (!ids.includes(id)) await writeJson(key, [...ids, id].slice(-MAX_KNOWN_IDS));
}

/** Calendars we write workouts to (created or adopted). */
export function getKnownTrainingCalendarIds(): Promise<string[]> {
  return readIds(KNOWN_IDS_KEY);
}

/** Calendars this app created on this device. */
export function getCreatedTrainingCalendarIds(): Promise<string[]> {
  return readIds(CREATED_IDS_KEY);
}

export async function rememberTrainingCalendarId(id: string, opts: { createdByApp: boolean }): Promise<void> {
  await addId(KNOWN_IDS_KEY, id);
  if (opts.createdByApp) await addId(CREATED_IDS_KEY, id);
}

export async function forgetTrainingCalendarId(id: string): Promise<void> {
  const [known, created] = await Promise.all([readIds(KNOWN_IDS_KEY), readIds(CREATED_IDS_KEY)]);
  await Promise.all([
    writeJson(KNOWN_IDS_KEY, known.filter((k) => k !== id)),
    writeJson(CREATED_IDS_KEY, created.filter((k) => k !== id)),
  ]);
}

/** A calendar we write workouts to (by id only: a user's own same-titled calendar stays readable). */
export function isTrainingCalendar(calendar: { id: string }, knownIds: readonly string[]): boolean {
  return knownIds.includes(calendar.id);
}
