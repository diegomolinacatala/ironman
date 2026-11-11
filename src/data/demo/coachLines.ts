/**
 * Building blocks of the rules coach's chat replies, written the way a coach
 * talks: the session with its objective, main target ("3×10' Z4 · 220–245 W
 * · RPE 7–8"), sensations and success criterion; the athlete's zones in ppm,
 * pace and watts; an easier version for a bad day; and the next weeks of the
 * season plan. Spanish (Spain), tú. Pure.
 */
import { formatDayLabel, formatDuration, formatWeekRange } from '@/domain/dates';
import { raceDistanceLabel, sportLabel } from '@/domain/labels';
import { nextRace } from '@/domain/periodization';
import { sessionFeel, targetSummary } from '@/domain/prescription';
import { buildSeason, type SeasonOverview, type SeasonWeek } from '@/domain/season';
import type { ISODate, Workout } from '@/domain/types';
import {
  athleteZones,
  targetParts,
  zoneTargets,
  type AthleteZones,
  type ZoneOptions,
  type ZoneRow,
} from '@/domain/zones';

import type { CoachContext } from './rulesCoach';

export type ZoneSportKey = 'run' | 'bike' | 'swim';

const ZONE_SPORT_LABEL: Readonly<Record<ZoneSportKey, string>> = { run: 'Carrera a pie', bike: 'Bici', swim: 'Natación' };
const SEASON_WEEKS_SHOWN = 3;
const EASY_SHARE = 0.6;
const EASY_MIN = 20;

export function joinEs(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;
}

/** Race distance of the target race: what "ritmo de carrera" means in the targets. */
export function zoneOptions(ctx: CoachContext): ZoneOptions {
  return { raceDistance: nextRace(ctx.races, ctx.today)?.distance ?? null };
}

// ---------------------------------------------------------------------------
// One session
// ---------------------------------------------------------------------------

/** «Bici umbral 3×10'» hoy a las 19:00 (bici, 1h 15'). */
export function sessionHeadline(w: Workout, today: ISODate): string {
  const at = w.startTime ? ` a las ${w.startTime}` : '';
  return `«${w.title}» ${formatDayLabel(w.date, today).toLowerCase()}${at} (${sportLabel(w.sport).toLowerCase()}, ${formatDuration(w.durationMin)})`;
}

/** "3×10' Z4 · 220–245 W · 150–158 ppm · RPE 7–8", or null for rest days. */
export function sessionTargets(w: Workout, ctx: CoachContext): string | null {
  return targetSummary(w, ctx.profile.thresholds, zoneOptions(ctx));
}

/** What a coach says about one session: objective, main target, sensations and success criterion. */
export function sessionBrief(w: Workout, ctx: CoachContext): string {
  const coaching = w.coaching ?? null;
  const targets = sessionTargets(w, ctx);
  const lines = [
    `${upperFirst(sessionHeadline(w, ctx.today))}.`,
    coaching?.objective ? `Objetivo: ${coaching.objective}` : null,
    targets ? `Clave: ${targets}.` : null,
    `Sensaciones: ${sessionFeel(w, ctx.profile.thresholds, zoneOptions(ctx))}`,
    coaching?.success ? `Lo has hecho bien si: ${coaching.success}` : null,
  ];
  return lines.filter((l): l is string => l !== null).join('\n');
}

function upperFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function round5(n: number): number {
  return Math.max(5, Math.round(n / 5) * 5);
}

/** A shorter, easy version of `w` for a bad day ("40' en Z1 · 120–141 ppm · RPE 1–2, sin series."). */
export function easierVersion(w: Workout, ctx: CoachContext): string {
  const minutes = Math.min(w.durationMin, Math.max(EASY_MIN, round5(w.durationMin * EASY_SHARE)));
  if (w.sport === 'strength') return `cámbiala por ${formatDuration(EASY_MIN)} de movilidad suave, sin cargas.`;
  if (w.sport === 'mobility' || w.sport === 'rest' || w.sport === 'other') return `hazla tranquila, ${formatDuration(minutes)} como mucho.`;
  const sport = w.sport === 'brick' ? 'bike' : w.sport;
  const easy = zoneTargets(sport, 'recovery', ctx.profile.thresholds, zoneOptions(ctx));
  const parts = targetParts(easy, sport).join(' · ');
  const what = w.sport === 'brick' ? 'solo bici, ' : '';
  const detail = sport === 'swim' ? 'técnica y nado suave, sin series' : 'sin series ni cambios de ritmo';
  return `${what}${formatDuration(minutes)} en Z1 (${parts}), ${detail}.`;
}

/** Plan B of the session (the coach's own, else the easier version). */
export function planBLines(w: Workout, ctx: CoachContext): string[] {
  const own = w.coaching?.planB ?? null;
  return [
    `Para ${sessionHeadline(w, ctx.today)}:`,
    own ? `• Plan B: ${own}` : null,
    `• Versión suave: ${easierVersion(w, ctx)}`,
    '• Y si estás peor de lo que parece, descansar también es entrenar.',
  ].filter((l): l is string => l !== null);
}

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

function zoneRowLine(row: ZoneRow, sport: ZoneSportKey): string {
  const parts = targetParts({ ...row, hrEstimated: false }, sport).join(' · ');
  const zone = row.intensity === 'race' ? 'Ritmo de carrera' : row.zone;
  return `• ${zone}: ${parts}`;
}

function sportZoneLines(zones: AthleteZones, sport: ZoneSportKey, withRace: boolean): string[] {
  const rows = zones[sport].filter((r) => r.intensity !== 'race' || withRace);
  return [`${ZONE_SPORT_LABEL[sport]}:`, ...rows.map((r) => zoneRowLine(r, sport))];
}

function missingLine(zones: AthleteZones): string | null {
  const count = zones.missing.length;
  if (count === 0) return null;
  const verb = count === 1 ? 'falta' : 'faltan';
  return `Para darte todos los números me ${verb} ${joinEs(zones.missing)}: ${count === 1 ? 'añádelo' : 'añádelos'} en Tú › Perfil.`;
}

/** The athlete's zones for `sports` (ppm, pace, watts, RPE) and what is missing for the rest. */
export function zoneLines(ctx: CoachContext, sports: readonly ZoneSportKey[]): string[] {
  const zones = athleteZones(ctx.profile.thresholds, zoneOptions(ctx));
  const race = nextRace(ctx.races, ctx.today);
  const blocks = sports.flatMap((sport) => sportZoneLines(zones, sport, race !== null));
  const estimated = zones.lthr.estimated
    ? 'Tus pulsaciones salen de tu FC máxima: con tu FC umbral real serán más precisas.'
    : null;
  const raceNote = race ? `El ritmo de carrera es el de tu ${raceDistanceLabel(race.distance).toLowerCase()}.` : null;
  return [...blocks, raceNote, estimated, missingLine(zones)].filter((l): l is string => l !== null);
}

// ---------------------------------------------------------------------------
// Season plan
// ---------------------------------------------------------------------------

function seasonWeekLine(w: SeasonWeek): string {
  const when = w.isCurrent ? 'Esta semana' : formatWeekRange(w.weekStart);
  const adjusted = w.plan ? ' (ajustada por ti)' : '';
  return `• ${when}: ${w.label}${adjusted} · ${formatDuration(w.targetMinutes)}. ${w.why}`;
}

/** The athlete's season plan (Plan → General) as the app shows it, with their adjusted weeks. */
export function seasonOf(ctx: CoachContext): SeasonOverview {
  return buildSeason({
    today: ctx.today,
    races: ctx.races,
    level: ctx.profile.level,
    weeklyHoursTarget: ctx.profile.availability.weeklyHoursTarget,
    weekPlans: ctx.weekPlans,
  });
}

/** Season summary, the next weeks (label, hours and why) and where to adjust them. */
export function seasonLines(ctx: CoachContext): string[] {
  const season = seasonOf(ctx);
  const next = season.weeks.slice(0, SEASON_WEEKS_SHOWN).map(seasonWeekLine);
  return [
    season.summary,
    next.length > 0 ? ['Lo próximo:', ...next].join('\n') : null,
    season.warnings[0] ?? null,
    'Puedes ajustar cualquier semana en Plan › General.',
  ].filter((l): l is string => Boolean(l));
}
