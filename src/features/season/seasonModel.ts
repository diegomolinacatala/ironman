/**
 * Plan → General (pure, unit-tested): the weeks grouped by block, the copy of
 * each row, hours / trend formatting, the spoken summary of the volume chart
 * and the date range the screen loads.
 */
import { format } from 'date-fns';
import { es } from 'date-fns/locale/es';

import { addDays, diffDays, parseISODate, startOfWeek } from '@/domain/dates';
import { buildSeason, type SeasonOverview, type SeasonWeek, type SeasonWeekKind } from '@/domain/season';
import type { DateRange, ISODate, Race, Workout } from '@/domain/types';
import { countdown, type Countdown } from '@/features/races/raceModel';
import type { IconName } from '@/ui';

/** `SeasonWeek.phaseLabel` of a maintenance base week (no subphase field on the week). */
const MAINTENANCE_LABEL = 'Mantenimiento';
const MORE_VOLUME_LABEL = 'Más volumen';
/** Closer than this the hero counts days instead of weeks. */
const COUNT_DAYS_UNDER = 14;

/** Big number of the hero: days under two weeks ("9 días"), weeks after that ("13 semanas"). */
export function raceCountdown(raceDate: ISODate, today: ISODate): Countdown {
  const days = diffDays(raceDate, today);
  if (days < COUNT_DAYS_UNDER) return countdown(raceDate, today);
  const weeks = Math.round(days / 7);
  return { value: String(weeks), unit: 'semanas', spoken: `Faltan ${weeks} semanas` };
}

export type SeasonBlockKey = 'prep' | 'maintenance' | 'base' | 'build' | 'final' | 'recovery' | 'transition';

export interface SeasonBlock {
  /** Unique per position ("base-1"). */
  id: string;
  key: SeasonBlockKey;
  /** "Base · 4 semanas", "Construcción · 6 semanas", "Afinamiento y carrera". */
  title: string;
  weeks: SeasonWeek[];
}

/** Monday of this week … Sunday of the overview's last week: the week plans and workouts to load. */
export function seasonRange(today: ISODate, races: readonly Race[]): DateRange {
  const from = startOfWeek(today);
  const weeks = buildSeason({ today, races, weeklyHoursTarget: 0 }).weeks;
  const last = weeks[weeks.length - 1]?.weekStart ?? from;
  return { from, to: addDays(last, 6) };
}

function blockKeyOf(week: SeasonWeek): SeasonBlockKey {
  switch (week.phase) {
    case 'prep':
      return 'prep';
    case 'base':
      return week.phaseLabel === MAINTENANCE_LABEL ? 'maintenance' : 'base';
    case 'build':
      return 'build';
    case 'peak':
    case 'taper':
    case 'race_week':
      return 'final';
    case 'recovery':
      return 'recovery';
    case 'transition':
      return 'transition';
  }
}

const BLOCK_NAME: Readonly<Record<Exclude<SeasonBlockKey, 'final'>, string>> = {
  prep: 'Preparación',
  maintenance: 'Mantenimiento',
  base: 'Base',
  build: 'Construcción',
  recovery: 'Recuperación',
  transition: 'Transición',
};

/** "1 semana" / "4 semanas". */
export function weeksCount(n: number): string {
  return n === 1 ? '1 semana' : `${n} semanas`;
}

function blockTitle(key: SeasonBlockKey, weeks: readonly SeasonWeek[]): string {
  if (key !== 'final') return `${BLOCK_NAME[key]} · ${weeksCount(weeks.length)}`;
  const hasRace = weeks.some((w) => w.phase === 'race_week');
  const hasTaper = weeks.some((w) => w.phase !== 'race_week');
  if (hasRace && hasTaper) return 'Afinamiento y carrera';
  return hasRace ? 'Carrera' : 'Afinamiento';
}

/** Consecutive weeks of the same block, in order. */
export function groupSeasonBlocks(weeks: readonly SeasonWeek[]): SeasonBlock[] {
  const groups = weeks.reduce<{ key: SeasonBlockKey; weeks: SeasonWeek[] }[]>((acc, week) => {
    const key = blockKeyOf(week);
    const last = acc[acc.length - 1];
    if (last && last.key === key) return [...acc.slice(0, -1), { key, weeks: [...last.weeks, week] }];
    return [...acc, { key, weeks: [week] }];
  }, []);
  return groups.map((g, i) => ({ id: `${g.key}-${i}`, key: g.key, title: blockTitle(g.key, g.weeks), weeks: g.weeks }));
}

function safeMinutes(minutes: number): number {
  return Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
}

/** 390 → "6 h 30'", 360 → "6 h", 45 → "45'". */
export function formatSeasonHours(minutes: number): string {
  const total = safeMinutes(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}'`;
  return m === 0 ? `${h} h` : `${h} h ${m}'`;
}

/** 390 → "6 horas y 30 minutos" (screen readers). */
export function spokenHours(minutes: number): string {
  const total = safeMinutes(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const hours = h === 1 ? '1 hora' : `${h} horas`;
  const mins = m === 1 ? '1 minuto' : `${m} minutos`;
  if (h === 0) return mins;
  return m === 0 ? hours : `${hours} y ${mins}`;
}

function trendPct(trend: number | null): number | null {
  return trend === null || !Number.isFinite(trend) ? null : Math.round(trend * 100);
}

/** 0.1 → "+10 %", −0.4 → "−40 %", 0 → "Igual"; null for the first week. */
export function formatTrend(trend: number | null): string | null {
  const pct = trendPct(trend);
  if (pct === null) return null;
  if (pct === 0) return 'Igual';
  return pct > 0 ? `+${pct} %` : `−${Math.abs(pct)} %`;
}

export function spokenTrend(trend: number | null): string | null {
  const pct = trendPct(trend);
  if (pct === null) return null;
  if (pct === 0) return 'igual que la semana anterior';
  return `${Math.abs(pct)} % ${pct > 0 ? 'más' : 'menos'} que la semana anterior`;
}

/** "9–15 nov", across months "30 nov–6 dic". */
export function weekDates(weekStart: ISODate): string {
  const start = parseISODate(weekStart);
  const end = parseISODate(addDays(weekStart, 6));
  const endLabel = format(end, 'd MMM', { locale: es });
  if (start.getMonth() === end.getMonth()) return `${start.getDate()}–${endLabel}`;
  return `${format(start, 'd MMM', { locale: es })}–${endLabel}`;
}

/** "semana del 9 de noviembre". */
export function spokenWeek(weekStart: ISODate): string {
  return `semana del ${format(parseISODate(weekStart), "d 'de' MMMM", { locale: es })}`;
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Esta semana · 9–15 nov · Base 2" / "16–22 nov · Base 2". */
export function weekCaption(week: SeasonWeek): string {
  const parts = [weekDates(week.weekStart), week.phaseLabel];
  return (week.isCurrent ? ['Esta semana', ...parts] : parts).join(' · ');
}

/** The override's note when there is one, else the coach's why. */
export function weekWhy(week: SeasonWeek): string {
  return week.plan?.note?.trim() || week.why;
}

/** Glyph of a week (row tile and picker). */
export function weekKindIcon(kind: SeasonWeekKind, label = ''): IconName {
  switch (kind) {
    case 'race':
      return 'flag';
    case 'taper':
      return 'bolt';
    case 'recovery':
    case 'transition':
      return 'moon';
    case 'rest':
      return 'rest';
    case 'push':
      return 'arrowUp';
    case 'load':
      return label === MORE_VOLUME_LABEL ? 'arrowUp' : 'fire';
  }
}

/** Marker under a bar of the volume strip: only the weeks that are not a normal load week. */
export function stripMarker(kind: SeasonWeekKind): IconName | null {
  if (kind === 'load' || kind === 'push') return null;
  return weekKindIcon(kind);
}

export interface LegendItem {
  icon: IconName;
  label: string;
}

const LEGEND_ORDER: readonly { kinds: readonly SeasonWeekKind[]; label: string }[] = [
  { kinds: ['recovery', 'transition'], label: 'Descarga' },
  { kinds: ['rest'], label: 'Semana libre' },
  { kinds: ['taper'], label: 'Afinamiento' },
  { kinds: ['race'], label: 'Carrera' },
];

/** Legend of the strip markers present in these weeks. */
export function legendItems(weeks: readonly SeasonWeek[]): LegendItem[] {
  return LEGEND_ORDER.filter((item) => weeks.some((w) => item.kinds.includes(w.kind))).map((item) => ({
    icon: stripMarker(item.kinds[0] ?? 'load') ?? 'fire',
    label: item.label,
  }));
}

/** Why a week cannot be adjusted (taper, race and post-race weeks follow the race), or null. */
export function adjustBlockedReason(week: SeasonWeek): string | null {
  if (week.editable) return null;
  switch (week.kind) {
    case 'taper':
      return `${week.label}: lo marca la carrera`;
    case 'race':
      return 'Semana de carrera: la organiza la carrera';
    case 'transition':
    case 'recovery':
      return 'Después de la carrera: toca recuperar';
    default:
      return 'La organiza la carrera';
  }
}

/** Sessions already planned per week (Monday → count), rest days and skipped sessions apart. */
export function sessionsByWeek(workouts: readonly Workout[]): Readonly<Record<ISODate, number>> {
  return workouts.reduce<Record<ISODate, number>>((acc, w) => {
    if (w.sport === 'rest' || w.status === 'skipped') return acc;
    const week = startOfWeek(w.date);
    return { ...acc, [week]: (acc[week] ?? 0) + 1 };
  }, {});
}

/** "Detallada · 6 sesiones" / "Sin detallar". */
export function detailLabel(sessions: number): string {
  if (sessions <= 0) return 'Sin detallar';
  return `Detallada · ${sessions === 1 ? '1 sesión' : `${sessions} sesiones`}`;
}

function listEs(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

function weekNumbers(weeks: readonly SeasonWeek[]): string {
  const numbers = listEs(weeks.map((w) => String(w.number)));
  return weeks.length === 1 ? `la semana ${numbers}` : `las semanas ${numbers}`;
}

/** Spoken version of the volume strip (it is one image for screen readers). */
export function volumeSpoken(weeks: readonly SeasonWeek[]): string {
  const current = weeks[0];
  if (!current) return '';
  const peak = weeks.reduce((a, b) => (b.targetMinutes > a.targetMinutes ? b : a), current);
  const marked = LEGEND_ORDER.map((item) => ({ label: item.label, list: weeks.filter((w) => item.kinds.includes(w.kind)) }))
    .filter((item) => item.list.length > 0)
    .map((item) => `${item.label} en ${weekNumbers(item.list)}`);
  const parts = [
    `Horas por semana durante ${weeksCount(weeks.length)}`,
    `Esta semana, ${spokenHours(current.targetMinutes)}`,
    `Máximo, ${spokenHours(peak.targetMinutes)} en ${weekNumbers([peak])}`,
    ...marked,
  ];
  return `${parts.join('. ')}.`;
}

/** Everything a week row says, for screen readers. */
export function weekRowLabel(week: SeasonWeek, sessions: number, keySessions: readonly string[]): string {
  const parts = [
    week.isCurrent ? `Esta semana, ${spokenWeek(week.weekStart)}` : capitalize(spokenWeek(week.weekStart)),
    week.label,
    week.phaseLabel,
    spokenHours(week.targetMinutes),
    spokenTrend(week.trend),
    week.plan ? 'Ajustada' : null,
    detailLabel(sessions),
    weekWhy(week),
    keySessions.length > 0 ? `Claves: ${keySessions.join(', ')}` : null,
  ];
  return parts.filter((p): p is string => Boolean(p)).join('. ');
}

/** Heading of the compact preview (onboarding). */
export function previewTitle(season: Pick<SeasonOverview, 'targetRace'>): string {
  return season.targetRace ? 'Así llegarás a tu carrera' : 'Tus próximas semanas';
}

/** "Esta semana: Carga, 6 horas y 30 minutos" (screen readers). */
export function previewWeekLabel(week: SeasonWeek): string {
  const when = week.isCurrent ? 'Esta semana' : capitalize(spokenWeek(week.weekStart));
  return `${when}: ${week.label}, ${spokenHours(week.targetMinutes)}`;
}
