/** Pure formatting helpers for workout cards and detail screens. */
import { formatDistance, formatDuration, formatTime } from '@/domain/dates';
import { intensityLabel, sportLabel } from '@/domain/labels';
import type { Workout } from '@/domain/types';

/** Duration to show: real duration once completed, planned otherwise. */
export function displayDurationMin(w: Workout): number {
  if (w.status === 'completed' && w.completed?.durationMin != null) return w.completed.durationMin;
  return w.durationMin;
}

/** Distance to show (metres) or null. */
export function displayDistanceM(w: Workout): number | null {
  if (w.status === 'completed' && w.completed?.distanceM != null) return w.completed.distanceM;
  return w.distanceM;
}

/** "18:30 · 1h 15' · 30 km" (parts omitted when missing). */
export function workoutMetaLine(w: Workout): string {
  const parts: string[] = [];
  const time = formatTime(w.startTime);
  if (time) parts.push(time);
  if (w.sport !== 'rest') parts.push(formatDuration(displayDurationMin(w)));
  const distance = displayDistanceM(w);
  if (distance != null && distance > 0) parts.push(formatDistance(distance, w.sport));
  return parts.join(' · ');
}

/** Start–end range "18:30–19:45" when the workout has a start time. */
export function timeRangeLabel(w: Pick<Workout, 'startTime' | 'durationMin'>): string | null {
  if (!w.startTime) return null;
  const [h, m] = w.startTime.split(':').map((n) => Number.parseInt(n, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const end = (h * 60 + m + Math.max(0, w.durationMin)) % (24 * 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${w.startTime}–${pad(Math.floor(end / 60))}:${pad(end % 60)}`;
}

export function workoutStatusLabel(w: Workout): string | null {
  if (w.status === 'completed') return 'Hecho';
  if (w.status === 'skipped') return 'Saltado';
  return null;
}

/** Screen-reader summary of a workout card. */
export function workoutA11yLabel(w: Workout, extra: { partnerName?: string | null; compliance?: string }): string {
  const parts = [sportLabel(w.sport), w.title, workoutMetaLine(w)];
  if (w.sport !== 'rest') parts.push(intensityLabel(w.intensity));
  if (w.isKey) parts.push('sesión clave');
  if (extra.partnerName) parts.push(`con ${extra.partnerName}`);
  const status = workoutStatusLabel(w);
  if (status) parts.push(status);
  if (extra.compliance) parts.push(extra.compliance);
  return parts.filter(Boolean).join(', ');
}
