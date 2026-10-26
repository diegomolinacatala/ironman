/**
 * Pure builder of the local notification schedule (rolling 7-day window).
 *
 * iOS keeps at most 64 pending local notifications, so we schedule only what
 * the next days need and rebuild the window whenever the app comes to the
 * foreground or the plan changes. Social notifications are remote push.
 */
import { addDays, formatDuration, formatTime, startOfWeek } from '@/domain/dates';
import { intensityLabel, sportLabel } from '@/domain/labels';
import type { ISODate, NotificationPrefs, Workout } from '@/domain/types';

import { atLocal, parseTimeMinutes } from '../time';

export const LOCAL_NOTIFICATION_KINDS = ['workout_reminder', 'morning_summary', 'evening_checkin', 'weekly_plan'] as const;
export type LocalNotificationKind = (typeof LOCAL_NOTIFICATION_KINDS)[number];

/** iOS category identifiers (no ':' or '-' allowed). */
export type NotificationCategoryId = 'workout' | 'summary' | 'checkin' | 'weekly';

export type NotificationTriggerSpec =
  | { type: 'date'; date: Date }
  | { type: 'daily'; hour: number; minute: number };

export interface NotificationSpec {
  /** Stable identifier: rescheduling replaces instead of duplicating. */
  id: string;
  kind: LocalNotificationKind;
  title: string;
  body: string;
  /** Expo Router path opened on tap. */
  url: string;
  categoryId: NotificationCategoryId;
  threadId: string;
  trigger: NotificationTriggerSpec;
}

export interface ScheduleInput {
  workouts: readonly Workout[];
  prefs: NotificationPrefs;
  today: ISODate;
  now: Date;
  /** Window length in days (default 7). */
  days?: number;
}

/** Below Apple's 64 so the system never silently drops the latest ones. */
export const MAX_SCHEDULED = 60;
export const DEFAULT_WINDOW_DAYS = 7;
const UNTIMED_REMINDER_MIN = 7 * 60 + 30;
const WEEKLY_PLAN_MIN = 19 * 60;
const WEEKLY_REMINDERS = 2;
const MAX_SUMMARY_ITEMS = 3;
const DEFAULT_MORNING_MIN = 7 * 60;
const DEFAULT_EVENING_MIN = 21 * 60;
const DEFAULT_LEAD_MIN = 30;
const MAX_LEAD_MIN = 24 * 60;

export function isLocalNotificationKind(value: unknown): value is LocalNotificationKind {
  return typeof value === 'string' && (LOCAL_NOTIFICATION_KINDS as readonly string[]).includes(value);
}

function sessionsOn(workouts: readonly Workout[], date: ISODate): Workout[] {
  return workouts
    .filter((w) => w.date === date && w.status === 'planned' && w.sport !== 'rest')
    .sort((a, b) => (parseTimeMinutes(a.startTime) ?? 1e9) - (parseTimeMinutes(b.startTime) ?? 1e9));
}

/** "30 min", "1 h", "1 h 30 min". */
export function leadLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function details(w: Workout): string {
  const parts = [sportLabel(w.sport), formatDuration(w.durationMin), intensityLabel(w.intensity)];
  return w.jointSessionId ? [...parts, 'Quedada'].join(' · ') : parts.join(' · ');
}

function workoutReminder(w: Workout, prefs: NotificationPrefs, now: Date): NotificationSpec | null {
  const start = parseTimeMinutes(w.startTime);
  if (start == null && prefs.morningSummary) return null; // the morning summary already covers it
  const leadRaw = Number.isFinite(prefs.reminderMinutesBefore) ? prefs.reminderMinutesBefore : DEFAULT_LEAD_MIN;
  const lead = Math.min(MAX_LEAD_MIN, Math.max(0, Math.round(leadRaw)));
  const fireAt =
    start == null
      ? atLocal(w.date, UNTIMED_REMINDER_MIN)
      : new Date(atLocal(w.date, start).getTime() - lead * 60_000);
  if (fireAt.getTime() <= now.getTime()) return null;
  const title =
    start == null ? `Hoy toca: ${w.title}` : lead === 0 ? `Empieza: ${w.title}` : `${w.title} en ${leadLabel(lead)}`;
  const body = start == null ? details(w) : `${formatTime(w.startTime)} · ${details(w)}`;
  return {
    id: `rti.workout.${w.id}`,
    kind: 'workout_reminder',
    title,
    body,
    url: `/workout/${w.id}`,
    categoryId: 'workout',
    threadId: 'rti.workouts',
    trigger: { type: 'date', date: fireAt },
  };
}

function summaryText(sessions: readonly Workout[]): { title: string; body: string } {
  const [first] = sessions;
  if (!first) return { title: 'Hoy toca descanso', body: 'Recupera bien: el descanso también es entreno.' };
  if (sessions.length === 1) {
    const time = formatTime(first.startTime);
    const when = time ? `${time} · ` : '';
    return { title: `Hoy: ${first.title}`, body: `${when}${details(first)}. ¡A por ello!` };
  }
  const listed = sessions.slice(0, MAX_SUMMARY_ITEMS).map((w) => `${w.title} (${formatDuration(w.durationMin)})`);
  const extra = sessions.length > MAX_SUMMARY_ITEMS ? ` y ${sessions.length - MAX_SUMMARY_ITEMS} más` : '';
  return { title: `Hoy: ${sessions.length} sesiones`, body: `${listed.join(' · ')}${extra}` };
}

function morningSummary(workouts: readonly Workout[], date: ISODate, minutes: number, now: Date): NotificationSpec | null {
  const fireAt = atLocal(date, minutes);
  if (fireAt.getTime() <= now.getTime()) return null;
  const text = summaryText(sessionsOn(workouts, date));
  return {
    id: `rti.morning.${date}`,
    kind: 'morning_summary',
    ...text,
    url: '/today',
    categoryId: 'summary',
    threadId: 'rti.summary',
    trigger: { type: 'date', date: fireAt },
  };
}

function eveningCheckin(minutes: number): NotificationSpec {
  return {
    id: 'rti.checkin.daily',
    kind: 'evening_checkin',
    title: '¿Qué tal el día?',
    body: 'Cuéntame cómo estás (sueño, fatiga, estrés) y ajusto tu plan. Son 20 segundos.',
    url: '/checkin',
    categoryId: 'checkin',
    threadId: 'rti.checkin',
    trigger: { type: 'daily', hour: Math.floor(minutes / 60), minute: minutes % 60 },
  };
}

/**
 * The next `count` Sundays at 19:00 strictly after `now`. The tap opens next
 * week in Semana: the user decides there whether to plan with the rules engine
 * or ask the AI coach — a notification must never start an AI request itself.
 */
function weeklyPlanReminders(today: ISODate, now: Date, count: number): NotificationSpec[] {
  const thisSunday = addDays(startOfWeek(today), 6);
  const sundays = Array.from({ length: count + 1 }, (_, i) => addDays(thisSunday, i * 7));
  return sundays
    .map((sunday) => ({ sunday, fireAt: atLocal(sunday, WEEKLY_PLAN_MIN) }))
    .filter(({ fireAt }) => fireAt.getTime() > now.getTime())
    .slice(0, count)
    .map(({ sunday, fireAt }) => ({
      id: `rti.weekly.${sunday}`,
      kind: 'weekly_plan' as const,
      title: 'Planifica tu semana',
      body: 'Echa un vistazo a la semana que viene y cuadra entrenos con tus amigos.',
      url: `/week?week=${addDays(sunday, 1)}`,
      categoryId: 'weekly' as const,
      threadId: 'rti.weekly',
      trigger: { type: 'date' as const, date: fireAt },
    }));
}

function sortKey(spec: NotificationSpec): number {
  return spec.trigger.type === 'date' ? spec.trigger.date.getTime() : 0;
}

/**
 * Notifications for the window [today, today + days): workout reminders,
 * morning summaries, the daily evening check-in (repeating) and the Sunday
 * planning reminder — each gated by the user's preferences. Capped at
 * `MAX_SCHEDULED`, keeping the soonest.
 */
export function buildSchedule(input: ScheduleInput): NotificationSpec[] {
  const { prefs, now, workouts } = input;
  const days = Array.from({ length: Math.max(1, input.days ?? DEFAULT_WINDOW_DAYS) }, (_, i) => addDays(input.today, i));
  const morningMin = parseTimeMinutes(prefs.morningTime) ?? DEFAULT_MORNING_MIN;
  const eveningMin = parseTimeMinutes(prefs.eveningTime) ?? DEFAULT_EVENING_MIN;

  const reminders = prefs.workoutReminders
    ? days.flatMap((date) => sessionsOn(workouts, date).map((w) => workoutReminder(w, prefs, now)))
    : [];
  const summaries = prefs.morningSummary ? days.map((date) => morningSummary(workouts, date, morningMin, now)) : [];
  const repeating = prefs.eveningCheckin ? [eveningCheckin(eveningMin)] : [];
  const weekly = prefs.weeklyPlanReminder ? weeklyPlanReminders(input.today, now, WEEKLY_REMINDERS) : [];

  const dated = [...reminders, ...summaries, ...weekly]
    .filter((s): s is NotificationSpec => s !== null)
    .sort((a, b) => sortKey(a) - sortKey(b));
  return [...repeating, ...dated].slice(0, MAX_SCHEDULED);
}

/** Router path from notification data: only in-app absolute paths are accepted. */
export function urlFromNotificationData(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const url = (data as Record<string, unknown>).url;
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) return null;
  return url;
}
