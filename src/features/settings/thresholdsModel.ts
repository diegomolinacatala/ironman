/**
 * Threshold inputs (FTP, run threshold pace, swim CSS, heart rates) as editable
 * strings ↔ domain `Thresholds`. Pure and unit-tested.
 */
import type { Thresholds } from '@/domain/types';

export type ThresholdKey = 'ftpW' | 'runPace' | 'swimCss' | 'maxHr' | 'lthr';

export type ThresholdInputs = Record<ThresholdKey, string>;

export type ThresholdErrors = Partial<Record<ThresholdKey, string>>;

export const EMPTY_THRESHOLD_INPUTS: ThresholdInputs = { ftpW: '', runPace: '', swimCss: '', maxHr: '', lthr: '' };

interface NumberRule {
  min: number;
  max: number;
  message: string;
}

const RULES: Record<ThresholdKey, NumberRule> = {
  ftpW: { min: 50, max: 600, message: 'El FTP debe estar entre 50 y 600 W' },
  runPace: { min: 150, max: 600, message: 'Ritmo entre 2:30 y 10:00 min/km' },
  swimCss: { min: 50, max: 240, message: 'CSS entre 0:50 y 4:00 min/100 m' },
  maxHr: { min: 120, max: 230, message: 'FC máxima entre 120 y 230 ppm' },
  lthr: { min: 90, max: 220, message: 'FC umbral entre 90 y 220 ppm' },
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

export function thresholdsToInputs(t: Thresholds | null | undefined): ThresholdInputs {
  return {
    ftpW: t?.ftpW != null ? String(t.ftpW) : '',
    runPace: t?.runThresholdPaceSecPerKm != null ? formatPace(t.runThresholdPaceSecPerKm) : '',
    swimCss: t?.swimCssSecPer100m != null ? formatPace(t.swimCssSecPer100m) : '',
    maxHr: t?.maxHr != null ? String(t.maxHr) : '',
    lthr: t?.lthr != null ? String(t.lthr) : '',
  };
}

const IS_PACE: Record<ThresholdKey, boolean> = {
  ftpW: false,
  runPace: true,
  swimCss: true,
  maxHr: false,
  lthr: false,
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

/** Thresholds fields owned by this editor. */
const MANAGED_KEYS = ['ftpW', 'runThresholdPaceSecPerKm', 'swimCssSecPer100m', 'maxHr', 'lthr'] as const;

export interface ParsedThresholds {
  thresholds: Thresholds;
  errors: ThresholdErrors;
  isValid: boolean;
}

/**
 * Converts string inputs to `Thresholds`. Fields left empty are omitted;
 * `base` keeps fields this editor does not handle (e.g. restingHr).
 */
export function parseThresholdInputs(inputs: ThresholdInputs, base: Thresholds = {}): ParsedThresholds {
  const results = (Object.keys(RULES) as ThresholdKey[]).map((key) => [key, parseField(key, inputs[key])] as const);
  const errors: ThresholdErrors = Object.fromEntries(
    results.filter(([, r]) => r.error !== null).map(([key, r]) => [key, r.error as string]),
  );
  const value = (key: ThresholdKey): number | undefined => {
    const found = results.find(([k]) => k === key);
    return found && found[1].value !== null ? found[1].value : undefined;
  };
  const rest = Object.fromEntries(
    Object.entries(base).filter(([k]) => !(MANAGED_KEYS as readonly string[]).includes(k)),
  ) as Thresholds;
  const thresholds: Thresholds = {
    ...rest,
    ...(value('ftpW') !== undefined ? { ftpW: value('ftpW') } : {}),
    ...(value('runPace') !== undefined ? { runThresholdPaceSecPerKm: value('runPace') } : {}),
    ...(value('swimCss') !== undefined ? { swimCssSecPer100m: value('swimCss') } : {}),
    ...(value('maxHr') !== undefined ? { maxHr: value('maxHr') } : {}),
    ...(value('lthr') !== undefined ? { lthr: value('lthr') } : {}),
  };
  return { thresholds, errors, isValid: Object.keys(errors).length === 0 };
}

export function countThresholds(t: Thresholds | null | undefined): number {
  if (!t) return 0;
  return [t.ftpW, t.runThresholdPaceSecPerKm, t.swimCssSecPer100m, t.maxHr, t.lthr].filter((v) => v != null).length;
}
