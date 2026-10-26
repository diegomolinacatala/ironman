/**
 * Garmin `activityType.typeKey` → app sport. Racket and team sports
 * (pádel, tenis, fútbol…) map to 'other'. Returns null for activities that are
 * not training (walks, transitions between triathlon legs, meditation).
 */
import type { Sport } from '../types.ts';

const SKIP = ['transition', 'walking', 'casual_walking', 'speed_walking', 'meditation', 'breathwork_meditation', 'sleep'];
const MOBILITY = ['yoga', 'pilates', 'stretch', 'mobility', 'breathwork'];
const BRICK = ['multi_sport', 'multisport', 'triathlon', 'duathlon', 'aquathlon'];

export function garminSport(typeKey: string): Sport | null {
  const key = typeKey.toLowerCase().trim();
  if (!key) return 'other';
  if (SKIP.some((s) => key === s || key.includes('transition'))) return null;
  if (BRICK.some((s) => key.includes(s))) return 'brick';
  if (key.includes('swim')) return 'swim';
  if (key.includes('cycl') || key.includes('bik') || key.includes('ride') || key === 'spinning') return 'bike';
  if (key.includes('run') && !key.includes('rowing')) return 'run';
  if (key.includes('strength') || key.includes('weight')) return 'strength';
  if (MOBILITY.some((s) => key.includes(s))) return 'mobility';
  return 'other';
}
