/**
 * The coach's quedada suggestion → card copy and the `/joint/new` prefill.
 * Pure. The suggestion is never sent: the athlete reviews the form first.
 */
import { formatDayMedium, formatDuration } from '@/domain/dates';
import type { QuedadaSuggestion } from '@/domain/types';
import { clampDuration, JOINT_LIMITS } from '@/features/together/jointForm';
import type { JointPrefill } from '@/features/together/types';
import { firstName } from '@/features/social/friendModel';

function capitalize(text: string): string {
  return text.length > 0 ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text;
}

/** "Quedada con David". */
export function quedadaHeading(quedada: Pick<QuedadaSuggestion, 'friendName'>): string {
  return `Quedada con ${firstName(quedada.friendName)}`;
}

/** "Sáb 8 nov · 08:00 · Rodaje juntos · 1h" (+ " · Retiro" when there is a place). */
export function quedadaDetail(quedada: QuedadaSuggestion): string {
  return [
    capitalize(formatDayMedium(quedada.date).replace(/\./g, '')),
    quedada.startTime,
    quedada.title,
    formatDuration(quedada.durationMin),
    quedada.location,
  ]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' · ');
}

/** Prefill for the "nueva quedada" form (the form clamps and re-validates everything again). */
export function prefillFromQuedada(quedada: QuedadaSuggestion): JointPrefill {
  const location = quedada.location?.trim();
  return {
    friendId: quedada.friendId,
    date: quedada.date,
    sport: quedada.sport === 'rest' ? undefined : quedada.sport,
    startTime: quedada.startTime ?? undefined,
    durationMin: clampDuration(quedada.durationMin),
    intensity: quedada.intensity,
    title: quedada.title.trim().slice(0, JOINT_LIMITS.titleMax) || undefined,
    location: location ? location.slice(0, JOINT_LIMITS.locationMax) : undefined,
  };
}
