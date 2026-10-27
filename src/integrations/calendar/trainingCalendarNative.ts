/**
 * EventKit side of the training calendar (expo-calendar 58 object API, iOS only):
 * find / create the dedicated "Road to Ironman" calendar, apply a sync plan, remove our data.
 *
 * Safety rules (a user's own calendar is never at risk):
 * - We write to: the stored calendar → one this app created on this device → a calendar
 *   titled "Road to Ironman" that holds nothing but our events (or nothing) → a new one.
 *   A same-titled calendar with someone else's events is never adopted.
 * - A calendar is only ever deleted when this app created it AND it holds no events but
 *   ours; otherwise only our events go (matched by the mapping or our workout URL).
 *
 * Calendar creation prefers the iCloud source (so the events reach the Mac and the Watch),
 * then the default calendar's source, then the local one. Event ids from `listEvents` are
 * EventKit `calendarItemIdentifier`s; we never look events up by id (EventKit's
 * `event(withIdentifier:)` expects a different id), we match them in the listing instead.
 */
import * as Calendar from 'expo-calendar';

import { addDays, todayISO } from '@/domain/dates';
import { logger } from '@/lib/logger';

import { rangeToWindow } from './mapping';
import type { EventLink } from './trainingCalendarStore';
import {
  forgetTrainingCalendarId,
  getCreatedTrainingCalendarIds,
  rememberTrainingCalendarId,
  TRAINING_CALENDAR_COLOR,
  TRAINING_CALENDAR_TITLE,
} from './trainingCalendarStore';
import { workoutIdFromUrl, type CalendarSyncPlan, type TrainingEventDetails } from './trainingEvents';

export type DeviceCalendarHandle = Calendar.ExpoCalendar;
export type DeviceEventHandle = Calendar.ExpoCalendarEvent;

export interface TrainingCalendarHandle {
  calendar: DeviceCalendarHandle;
  createdByApp: boolean;
}

/** How far we look when checking / clearing a whole calendar (EventKit caps a query at 4 years). */
const SCAN_PAST_DAYS = 365;
const SCAN_FUTURE_DAYS = 730;

function scanWindow(): { start: Date; end: Date } {
  const today = todayISO();
  return rangeToWindow({ from: addDays(today, -SCAN_PAST_DAYS), to: addDays(today, SCAN_FUTURE_DAYS) });
}

/** One of the events we wrote: in the mapping, or carrying our `…://workout/<id>` URL. */
export function isOurEvent(event: { id: string; url?: string | null }, knownEventIds: ReadonlySet<string>): boolean {
  return knownEventIds.has(event.id) || workoutIdFromUrl(event.url) !== null;
}

async function calendarById(id: string | null): Promise<DeviceCalendarHandle | null> {
  if (!id) return null;
  try {
    const calendar = await Calendar.ExpoCalendar.get(id);
    return calendar.allowsModifications ? calendar : null;
  } catch {
    return null;
  }
}

async function holdsOnlyOurEvents(calendar: DeviceCalendarHandle, knownEventIds: ReadonlySet<string>): Promise<boolean> {
  const window = scanWindow();
  const events = await calendar.listEvents(window.start, window.end);
  return events.every((event) => isOurEvent(event, knownEventIds));
}

/** A same-titled calendar we may reuse: empty or only our events (e.g. after reinstalling the app). */
async function adoptableByTitle(knownEventIds: ReadonlySet<string>): Promise<DeviceCalendarHandle | null> {
  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  for (const calendar of calendars) {
    if (calendar.title !== TRAINING_CALENDAR_TITLE || !calendar.allowsModifications) continue;
    if (await holdsOnlyOurEvents(calendar, knownEventIds).catch(() => false)) return calendar;
  }
  return null;
}

function defaultSourceId(): string | undefined {
  try {
    return Calendar.getDefaultCalendarSync().source?.id;
  } catch {
    return undefined;
  }
}

/** Source ids to try, best first: iCloud, the default calendar's account, local. */
function candidateSourceIds(): string[] {
  let sources: Calendar.Source[] = [];
  try {
    sources = Calendar.getSourcesSync();
  } catch (error) {
    logger.debug('training calendar: no sources', error);
  }
  const icloud = sources.find((s) => /icloud/i.test(s.name));
  const local = sources.find((s) => s.type === Calendar.SourceType.LOCAL);
  const ids = [icloud?.id, defaultSourceId(), local?.id].filter((id): id is string => typeof id === 'string' && id.length > 0);
  return [...new Set(ids)];
}

async function createTrainingCalendar(): Promise<DeviceCalendarHandle> {
  const base = { title: TRAINING_CALENDAR_TITLE, name: TRAINING_CALENDAR_TITLE, color: TRAINING_CALENDAR_COLOR, entityType: Calendar.EntityTypes.EVENT };
  for (const sourceId of candidateSourceIds()) {
    try {
      return await Calendar.createCalendar({ ...base, sourceId });
    } catch (error) {
      // e.g. an Exchange / Google account that does not allow new calendars.
      logger.warn('training calendar: source refused the calendar', error);
    }
  }
  return Calendar.createCalendar(base);
}

async function remember(calendar: DeviceCalendarHandle, createdByApp: boolean): Promise<TrainingCalendarHandle> {
  await rememberTrainingCalendarId(calendar.id, { createdByApp });
  return { calendar, createdByApp };
}

/** The calendar to write to (see the rules above). */
export async function ensureTrainingCalendar(
  storedId: string | null,
  knownEventIds: ReadonlySet<string> = new Set(),
): Promise<TrainingCalendarHandle> {
  const created = await getCreatedTrainingCalendarIds();
  const stored = await calendarById(storedId);
  if (stored) return remember(stored, created.includes(stored.id));
  for (const id of created) {
    const ours = await calendarById(id);
    if (ours) return remember(ours, true);
  }
  const adopted = await adoptableByTitle(knownEventIds);
  if (adopted) return remember(adopted, false);
  return remember(await createTrainingCalendar(), true);
}

function toEventFields(details: TrainingEventDetails) {
  return {
    title: details.title,
    startDate: details.startDate,
    endDate: details.endDate,
    allDay: details.allDay,
    notes: details.notes,
    url: details.url,
    alarms: details.alarms,
    ...(details.timeZone ? { timeZone: details.timeZone } : {}),
  };
}

export interface AppliedSync {
  created: number;
  updated: number;
  deleted: number;
  mapping: Record<string, EventLink>;
}

async function tryStep(label: string, step: () => Promise<void>): Promise<boolean> {
  try {
    await step();
    return true;
  } catch (error) {
    logger.warn(`training calendar: ${label} failed`, error);
    return false;
  }
}

/** Writes the plan. Failures are per event (logged); an update whose event vanished is recreated. */
export async function applyCalendarPlan(
  calendar: DeviceCalendarHandle,
  existing: readonly DeviceEventHandle[],
  plan: CalendarSyncPlan,
): Promise<AppliedSync> {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const mapping: Record<string, EventLink> = { ...plan.mapping };
  let deleted = 0;
  let updated = 0;
  let created = 0;

  for (const id of plan.deletes) {
    const event = byId.get(id);
    if (event && (await tryStep('delete', () => event.delete()))) deleted += 1;
  }
  const toCreate = [...plan.creates];
  for (const write of plan.updates) {
    const event = byId.get(write.eventId);
    if (event && (await tryStep('update', () => event.update(toEventFields(write.details))))) {
      updated += 1;
      continue;
    }
    // The event vanished (deleted by hand, id changed by a full iCloud sync): write it again.
    delete mapping[write.workoutId];
    toCreate.push(write);
  }
  for (const write of toCreate) {
    const ok = await tryStep('create', async () => {
      const event = await calendar.createEvent(toEventFields(write.details));
      mapping[write.workoutId] = { eventId: event.id, signature: write.signature };
    });
    if (ok) created += 1;
  }
  return { created, updated, deleted, mapping };
}

/**
 * Removes what we wrote to the stored calendar: the calendar itself only when this app
 * created it and it holds nothing else; otherwise just our events. Never looks for other
 * calendars. Resolves true when the calendar itself was deleted.
 */
export async function removeTrainingCalendarData(storedId: string | null, knownEventIds: ReadonlySet<string>): Promise<boolean> {
  const calendar = await calendarById(storedId);
  if (!calendar) return false;
  const window = scanWindow();
  const events = await calendar.listEvents(window.start, window.end);
  const ours = events.filter((event) => isOurEvent(event, knownEventIds));
  const createdByApp = (await getCreatedTrainingCalendarIds()).includes(calendar.id);
  if (createdByApp && ours.length === events.length && (await tryStep('delete calendar', () => calendar.delete()))) {
    await forgetTrainingCalendarId(calendar.id);
    return true;
  }
  for (const event of ours) await tryStep('delete', () => event.delete());
  return false;
}
