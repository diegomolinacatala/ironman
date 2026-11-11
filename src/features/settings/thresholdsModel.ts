/**
 * Threshold inputs (FTP, run threshold pace, swim CSS, heart rates) as editable
 * strings ↔ domain `Thresholds`, plus the "Tus zonas" preview rows. Pure and unit-tested.
 */
import type { Intensity, Thresholds } from '@/domain/types';
import { athleteZones, formatHrRange, formatPaceRange, formatPowerRange, formatRpe, type ZoneRow } from '@/domain/zones';

export type ThresholdKey = 'ftpW' | 'runPace' | 'swimCss' | 'maxHr' | 'lthr' | 'restingHr';

export type ThresholdInputs = Record<ThresholdKey, string>;

export type ThresholdErrors = Partial<Record<ThresholdKey, string>>;

export const EMPTY_THRESHOLD_INPUTS: ThresholdInputs = { ftpW: '', runPace: '', swimCss: '', maxHr: '', lthr: '', restingHr: '' };

interface NumberRule {
  min: number;
  max: number;
  message: string;
}

/** Limits mirror domain/validation `thresholdsSchema` (FTP ≤ 700 W, resting HR 25–120). */
const RULES: Record<ThresholdKey, NumberRule> = {
  ftpW: { min: 50, max: 700, message: 'El FTP debe estar entre 50 y 700 W' },
  runPace: { min: 150, max: 600, message: 'Ritmo entre 2:30 y 10:00 min/km' },
  swimCss: { min: 50, max: 240, message: 'CSS entre 0:50 y 4:00 min/100 m' },
  maxHr: { min: 120, max: 230, message: 'FC máxima entre 120 y 230 ppm' },
  lthr: { min: 90, max: 220, message: 'FC umbral entre 90 y 220 ppm' },
  restingHr: { min: 25, max: 120, message: 'FC en reposo entre 25 y 120 ppm' },
};

/** "4:30" → 270 seconds. Accepts "4:30", "4.30", "4'30" and plain minutes "5". Returns null if invalid. */
export function parsePace(input: string): number | null {
  const text = input.trim().replace(/[.'’,]/g, ':');
  if (!text) return null;
  const match = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = match[2] === undefined ? 0 : Number(match[2]);
  if (seconds >= 60) return null;
  return minutes * 60 + seconds;
}

/** 270 → "4:30". */
export function formatPace(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function parseInteger(input: string): number | null {
  const text = input.trim();
  if (!/^\d{1,4}$/.test(text)) return null;
  return Number(text);
}

function numberInput(n: number | undefined): string {
  return n != null ? String(n) : '';
}

export function thresholdsToInputs(t: Thresholds | null | undefined): ThresholdInputs {
  return {
    ftpW: numberInput(t?.ftpW),
    runPace: t?.runThresholdPaceSecPerKm != null ? formatPace(t.runThresholdPaceSecPerKm) : '',
    swimCss: t?.swimCssSecPer100m != null ? formatPace(t.swimCssSecPer100m) : '',
    maxHr: numberInput(t?.maxHr),
    lthr: numberInput(t?.lthr),
    restingHr: numberInput(t?.restingHr),
  };
}

const IS_PACE: Record<ThresholdKey, boolean> = {
  ftpW: false,
  runPace: true,
  swimCss: true,
  maxHr: false,
  lthr: false,
  restingHr: false,
};

/** Input key → `Thresholds` field. */
const FIELD_OF: Record<ThresholdKey, keyof Thresholds> = {
  ftpW: 'ftpW',
  runPace: 'runThresholdPaceSecPerKm',
  swimCss: 'swimCssSecPer100m',
  maxHr: 'maxHr',
  lthr: 'lthr',
  restingHr: 'restingHr',
};

function parseField(key: ThresholdKey, raw: string): { value: number | null; error: string | null } {
  if (!raw.trim()) return { value: null, error: null };
  const parsed = IS_PACE[key] ? parsePace(raw) : parseInteger(raw);
  const rule = RULES[key];
  if (parsed === null) {
    return { value: null, error: IS_PACE[key] ? 'Usa el formato mm:ss, p. ej. 4:45' : 'Escribe solo números' };
  }
  if (parsed < rule.min || parsed > rule.max) return { value: null, error: rule.message };
  return { value: parsed, error: null };
}

export interface ParsedThresholds {
  thresholds: Thresholds;
  errors: ThresholdErrors;
  isValid: boolean;
}

/**
 * Converts string inputs to `Thresholds`. Fields left empty are omitted;
 * `base` keeps fields this editor does not handle (future additions).
 */
export function parseThresholdInputs(inputs: ThresholdInputs, base: Thresholds = {}): ParsedThresholds {
  const keys = Object.keys(RULES) as ThresholdKey[];
  const results = keys.map((key) => [key, parseField(key, inputs[key] ?? '')] as const);
  const errors: ThresholdErrors = Object.fromEntries(
    results.filter(([, r]) => r.error !== null).map(([key, r]) => [key, r.error as string]),
  );
  const managed = new Set<string>(Object.values(FIELD_OF));
  const rest = Object.fromEntries(Object.entries(base).filter(([k]) => !managed.has(k))) as Thresholds;
  const parsed = Object.fromEntries(
    results.filter(([, r]) => r.value !== null).map(([key, r]) => [FIELD_OF[key], r.value as number]),
  ) as Thresholds;
  return { thresholds: { ...rest, ...parsed }, errors, isValid: Object.keys(errors).length === 0 };
}

export function countThresholds(t: Thresholds | null | undefined): number {
  if (!t) return 0;
  return [t.ftpW, t.runThresholdPaceSecPerKm, t.swimCssSecPer100m, t.maxHr, t.lthr].filter((v) => v != null).length;
}

// ---------------------------------------------------------------------------
// "Tus zonas" preview
// ---------------------------------------------------------------------------

export type ZonePreviewSport = 'run' | 'bike' | 'swim';

export const ZONE_PREVIEW_SPORTS: readonly { value: ZonePreviewSport; label: string }[] = [
  { value: 'run', label: 'Carrera' },
  { value: 'bike', label: 'Bici' },
  { value: 'swim', label: 'Natación' },
];

const ZONE_LABEL: Readonly<Record<Exclude<Intensity, 'race'>, string>> = {
  recovery: 'Recuperación',
  endurance: 'Fondo',
  tempo: 'Tempo',
  threshold: 'Umbral',
  vo2: 'VO2',
};

export interface ZonePreviewRow {
  intensity: Intensity;
  /** "Z1" … "Z5". */
  zone: string;
  /** "Recuperación", "Fondo"… */
  name: string;
  /** "145–151 ppm · 5:08–5:48 /km" (RPE only when nothing else is known). */
  values: string;
}

function rowValues(row: ZoneRow, sport: ZonePreviewSport, hrEstimated: boolean): string {
  const hr = row.hr ? `${formatHrRange(row.hr)}${hrEstimated ? ' aprox.' : ''}` : null;
  const parts =
    sport === 'run'
      ? [hr, row.pace ? formatPaceRange(row.pace, 'run') : null]
      : sport === 'bike'
        ? [row.power ? formatPowerRange(row.power) : null, hr]
        : [row.pace ? formatPaceRange(row.pace, 'swim') : null];
  const known = parts.filter((p): p is string => p !== null);
  return known.length > 0 ? known.join(' · ') : formatRpe(row.rpe);
}

/** Z1–Z5 of one sport with the athlete's numbers ("aprox." when the HR comes from the max HR). */
export function zonePreviewRows(thresholds: Thresholds, sport: ZonePreviewSport): ZonePreviewRow[] {
  const zones = athleteZones(thresholds);
  return zones[sport]
    .filter((row) => row.intensity !== 'race')
    .map((row) => ({
      intensity: row.intensity,
      zone: row.zone,
      name: ZONE_LABEL[row.intensity as Exclude<Intensity, 'race'>],
      values: rowValues(row, sport, zones.lthr.estimated),
    }));
}

/** What the athlete can add to see every number of that sport ("" when nothing is missing). */
export function zonePreviewNote(thresholds: Thresholds, sport: ZonePreviewSport): string {
  const zones = athleteZones(thresholds);
  const missing = {
    hr: zones.lthr.run === null,
    pace: thresholds.runThresholdPaceSecPerKm == null,
    ftp: thresholds.ftpW == null,
    css: thresholds.swimCssSecPer100m == null,
  };
  const items =
    sport === 'run'
      ? [missing.hr ? 'tu FC umbral o tu FC máxima' : null, missing.pace ? 'tu ritmo umbral' : null]
      : sport === 'bike'
        ? [missing.ftp ? 'tu FTP' : null, missing.hr ? 'tu FC umbral o tu FC máxima' : null]
        : [missing.css ? 'tu CSS' : null];
  const list = items.filter((i): i is string => i !== null);
  if (list.length === 0) {
    return zones.lthr.estimated && sport !== 'swim' ? 'Pulsaciones aproximadas: con tu FC umbral serán más precisas.' : '';
  }
  return `Añade ${list.join(' y ')} para ver aquí tus números.`;
}
