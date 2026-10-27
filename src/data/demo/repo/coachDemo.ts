/**
 * Demo coach: the rules engine plus a tiny imitation of what the AI coach
 * does in v2 — it logs an injury mentioned in the message as an imprevisto
 * and remembers explicit preferences ("prefiero…", "me gusta más…") in
 * `profile.coachNotes`, returning both as `lifeEvent` / `memory`.
 */
import { addDays } from '@/domain/dates';
import type { BodyArea, CoachRequest, CoachResponse, ISODate, LifeEvent } from '@/domain/types';

import type { Repository } from '../../repository';
import { runRulesCoach, type RulesCoachRepo } from '../rulesCoach';
import { requireMe, type DemoDeps } from './common';

export type CoachDemoRepo = RulesCoachRepo & Pick<Repository, 'createLifeEvent' | 'upsertMyProfile'>;

const INJURY_RE = /me duele|dolor|lesi[oó]n|torc[ií]|esguince|molesti|tobillo|rodilla/i;
const PREFERENCE_RE = /^(?:yo\s+)?(prefiero|me gusta m[aá]s)\s+(.+)$/i;
/** Same limit the server keeps for `profiles.coach_notes` (newest lines kept). */
export const COACH_NOTES_MAX = 2000;
const NOTE_MAX = 160;
/** An injury logged from chat covers today and the next two days. */
const INJURY_DAYS = 3;

const BODY_AREAS: readonly [BodyArea, RegExp, string][] = [
  ['ankle', /tobillo/i, 'el tobillo'],
  ['knee', /rodilla/i, 'la rodilla'],
  ['achilles', /aquiles/i, 'el Aquiles'],
  ['calf', /gemelo|pantorrilla/i, 'el gemelo'],
  ['shin', /espinilla|tibia|periostitis/i, 'la espinilla'],
  ['hamstring', /isquio/i, 'el isquiotibial'],
  ['quad', /cu[aá]driceps/i, 'el cuádriceps'],
  ['hip', /cadera/i, 'la cadera'],
  ['back', /espalda|lumbar/i, 'la espalda'],
  ['shoulder', /hombro/i, 'el hombro'],
  ['neck', /cuello|cervical/i, 'el cuello'],
  ['foot', /\bpie\b|planta del pie|fascitis/i, 'el pie'],
];

export interface InjuryMention {
  bodyArea: BodyArea | null;
  title: string;
}

/** "Me duele el tobillo" → { bodyArea: 'ankle', title: 'Molestia en el tobillo' }; null when no pain is mentioned. */
export function detectInjury(message: string): InjuryMention | null {
  if (!INJURY_RE.test(message)) return null;
  const area = BODY_AREAS.find(([, re]) => re.test(message));
  return area ? { bodyArea: area[0], title: `Molestia en ${area[2]}` } : { bodyArea: null, title: 'Molestia o dolor' };
}

export interface PreferenceMention {
  /** Third person, as stored in coach notes ("Prefiere nadar por la mañana"). */
  memory: string;
  /** Second person, for the reply ("prefieres nadar por la mañana"). */
  spoken: string;
}

/** "Prefiero nadar por la mañana." → memory "Prefiere nadar por la mañana". */
export function detectPreference(message: string): PreferenceMention | null {
  const match = PREFERENCE_RE.exec(message.trim());
  const rest = match?.[2]?.replace(/[.!?¡¿\s]+$/u, '').trim().slice(0, NOTE_MAX);
  if (!match?.[1] || !rest) return null;
  const prefers = match[1].toLowerCase() === 'prefiero';
  return {
    memory: `${prefers ? 'Prefiere' : 'Le gusta más'} ${rest}`,
    spoken: `${prefers ? 'prefieres' : 'te gusta más'} ${rest}`,
  };
}

/** Appends a line to the coach notes (deduped), keeping the newest lines within COACH_NOTES_MAX. */
export function appendCoachNote(notes: string | null, line: string): string {
  const lines = (notes ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.some((l) => l.toLowerCase() === line.toLowerCase())) return lines.join('\n');
  let kept = [...lines, line];
  while (kept.length > 1 && kept.join('\n').length > COACH_NOTES_MAX) kept = kept.slice(1);
  return kept.join('\n').slice(-COACH_NOTES_MAX);
}

async function logInjury(repo: CoachDemoRepo, injury: InjuryMention, message: string, today: ISODate): Promise<LifeEvent> {
  const todays = await repo.listLifeEvents({ from: today, to: today });
  const same = todays.find((e) => e.kind === 'injury' && e.startDate === today && e.bodyArea === injury.bodyArea);
  if (same) return same;
  return repo.createLifeEvent({
    kind: 'injury',
    title: injury.title,
    startDate: today,
    endDate: addDays(today, INJURY_DAYS - 1),
    severity: 2,
    bodyArea: injury.bodyArea,
    notes: message.slice(0, 500),
  });
}

async function rememberPreference(repo: CoachDemoRepo, memory: string): Promise<void> {
  const profile = await repo.getMyProfile();
  if (!profile) return;
  const coachNotes = appendCoachNote(profile.coachNotes, memory);
  if (coachNotes !== profile.coachNotes) await repo.upsertMyProfile({ coachNotes });
}

function noticeOf(lifeEvent: LifeEvent | null, preference: PreferenceMention | null): string | undefined {
  const parts = [
    lifeEvent ? `He apuntado «${lifeEvent.title}» en tus imprevistos.` : null,
    preference ? `Me apunto que ${preference.spoken}.` : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

export function createDemoCoach({ store }: DemoDeps, repo: CoachDemoRepo): (request: CoachRequest) => Promise<CoachResponse> {
  return async (request) => {
    await requireMe(store);
    const today = store.clock().today;
    const message = request.message?.trim() ?? '';
    const injury = request.lifeEventId ? null : detectInjury(message);
    const preference = detectPreference(message);
    const lifeEvent = injury ? await logInjury(repo, injury, message, today) : null;
    if (preference) await rememberPreference(repo, preference.memory);
    // A re-plan request about a new injury re-plans around the event just logged.
    const effective = lifeEvent && request.mode === 'replan' ? { ...request, lifeEventId: lifeEvent.id } : request;
    const response = await runRulesCoach(repo, effective, { today, notice: noticeOf(lifeEvent, preference), injuryLogged: lifeEvent !== null });
    return { ...response, memory: preference ? [preference.memory] : [], lifeEvent };
  };
}
