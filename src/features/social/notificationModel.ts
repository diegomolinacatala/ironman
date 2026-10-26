/**
 * Pure helpers for the notifications inbox: grouping, deep links and icons.
 */
import { startOfWeek, toISODate } from '@/domain/dates';
import type { AppNotification, NotificationType } from '@/domain/types';
import type { IconName } from '@/ui';

export type NotificationGroupKey = 'today' | 'week' | 'older';

export interface NotificationGroup {
  key: NotificationGroupKey;
  title: string;
  items: AppNotification[];
}

const GROUP_TITLES: Record<NotificationGroupKey, string> = {
  today: 'Hoy',
  week: 'Esta semana',
  older: 'Antes',
};

function groupKeyOf(createdAt: string, today: string, weekStart: string): NotificationGroupKey {
  const parsed = new Date(createdAt);
  if (!Number.isFinite(parsed.getTime())) return 'older';
  const day = toISODate(parsed);
  if (day >= today) return 'today';
  if (day >= weekStart) return 'week';
  return 'older';
}

/** Groups newest-first into Hoy / Esta semana (since Monday) / Antes, skipping empty groups. */
export function groupNotifications(items: readonly AppNotification[], now: Date = new Date()): NotificationGroup[] {
  const today = toISODate(now);
  const weekStart = startOfWeek(today);
  const sorted = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const keys: NotificationGroupKey[] = ['today', 'week', 'older'];
  return keys
    .map((key) => ({
      key,
      title: GROUP_TITLES[key],
      items: sorted.filter((n) => groupKeyOf(n.createdAt, today, weekStart) === key),
    }))
    .filter((group) => group.items.length > 0);
}

export function unreadCount(items: readonly AppNotification[] | undefined): number {
  return (items ?? []).filter((n) => n.readAt === null).length;
}

const APP_SCHEME = /^roadtoironman:\/\//;

/** Only in-app paths are followed (never external URLs coming from data). */
export function toInternalPath(url: string): string | null {
  const trimmed = url.trim();
  if (APP_SCHEME.test(trimmed)) {
    const path = trimmed.replace(APP_SCHEME, '/');
    return path === '/' ? null : path;
  }
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
  return null;
}

function readId(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' && value.length > 0 ? encodeURIComponent(value) : null;
}

/** Juntos shows incoming requests with Aceptar / Rechazar at the top. */
const TYPE_FALLBACK: Partial<Record<NotificationType, string>> = {
  friend_request: '/together',
  friend_accepted: '/together',
  friend_completed: '/together',
  kudos: '/together',
};

/** The inbox itself: older rows linked here, which only stacked another inbox. */
const INBOX_PATH = /^\/notifications\/?(?:[?#].*)?$/;

/** Where tapping a notification should go, or null when there is nothing to open. */
export function notificationHref(notification: AppNotification): string | null {
  const { data, type } = notification;
  const url = data.url;
  if (typeof url === 'string') {
    const internal = toInternalPath(url);
    if (internal && !INBOX_PATH.test(internal)) return internal;
  }
  const joint = readId(data, 'jointSessionId');
  if (joint) return `/joint/${joint}`;
  const proposal = readId(data, 'proposalId');
  if (proposal) return `/proposal/${proposal}`;
  const workout = readId(data, 'workoutId');
  if (workout) return `/workout/${workout}`;
  return TYPE_FALLBACK[type] ?? null;
}

const TAB_PATH = /^\/(today|week|together|progress|me)\/?(?:[?#].*)?$/;

/** Tab routes are reached by going back to the tabs, not by stacking another tab bar. */
export function isTabPath(path: string): boolean {
  return TAB_PATH.test(path);
}

const TYPE_ICON: Record<NotificationType, IconName> = {
  friend_request: 'together',
  friend_accepted: 'checkCircle',
  joint_invite: 'calendarBadge',
  joint_response: 'send',
  joint_cancelled: 'close',
  plan_updated: 'sparkles',
  friend_completed: 'flag',
  kudos: 'heart',
};

export function notificationIcon(type: NotificationType): IconName {
  return TYPE_ICON[type] ?? 'bell';
}
