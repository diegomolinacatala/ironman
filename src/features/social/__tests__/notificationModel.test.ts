import { describe, expect, test } from '@jest/globals';

import { notification } from '@/features/together/__tests__/fixtures';

import { groupNotifications, isTabPath, notificationHref, notificationIcon, toInternalPath, unreadCount } from '../notificationModel';

describe('groupNotifications', () => {
  // Sunday 25 Oct 2026, 12:00 local → week started Monday 19.
  const now = new Date(2026, 9, 25, 12, 0);

  test('groups into Hoy / Esta semana / Antes newest first and skips empty groups', () => {
    const groups = groupNotifications(
      [
        notification({ id: 'old', createdAt: '2026-10-10T10:00:00' }),
        notification({ id: 'today-early', createdAt: '2026-10-25T08:00:00' }),
        notification({ id: 'monday', createdAt: '2026-10-19T09:00:00' }),
        notification({ id: 'today-late', createdAt: '2026-10-25T11:00:00' }),
      ],
      now,
    );
    expect(groups.map((g) => [g.title, g.items.map((n) => n.id)])).toEqual([
      ['Hoy', ['today-late', 'today-early']],
      ['Esta semana', ['monday']],
      ['Antes', ['old']],
    ]);
    expect(groupNotifications([notification({ createdAt: '2026-10-25T08:00:00' })], now).map((g) => g.key)).toEqual(['today']);
  });

  test('invalid dates go to Antes', () => {
    expect(groupNotifications([notification({ createdAt: 'nope' })], now)[0]?.key).toBe('older');
  });
});

describe('notificationHref', () => {
  test('follows internal urls and app-scheme links only', () => {
    expect(notificationHref(notification({ data: { url: '/joint/123' } }))).toBe('/joint/123');
    expect(notificationHref(notification({ data: { url: 'rebufo://workout/9' } }))).toBe('/workout/9');
    expect(notificationHref(notification({ data: { url: 'https://evil.example/x', jointSessionId: 'j7' } }))).toBe('/joint/j7');
    expect(notificationHref(notification({ data: { url: '//evil.example' } }))).toBeNull();
  });

  test('falls back to ids in data and then to the type', () => {
    expect(notificationHref(notification({ type: 'plan_updated', data: { proposalId: 'p 1' } }))).toBe('/proposal/p%201');
    expect(notificationHref(notification({ type: 'friend_completed', data: { workoutId: 'w1' } }))).toBe('/workout/w1');
    expect(notificationHref(notification({ type: 'friend_request', data: {} }))).toBe('/together');
    expect(notificationHref(notification({ type: 'kudos', data: {} }))).toBe('/together');
    expect(notificationHref(notification({ type: 'joint_cancelled', data: {} }))).toBeNull();
  });

  test('friend requests open Juntos (where Aceptar/Rechazar live), also for old rows linking the inbox', () => {
    expect(notificationHref(notification({ type: 'friend_request', data: { url: '/together' } }))).toBe('/together');
    expect(notificationHref(notification({ type: 'friend_request', data: { url: '/notifications' } }))).toBe('/together');
    expect(notificationHref(notification({ type: 'friend_request', data: { url: 'rebufo://notifications' } }))).toBe('/together');
    expect(notificationHref(notification({ type: 'joint_cancelled', data: { url: '/notifications/' } }))).toBeNull();
  });

  test('tab paths are recognised so the inbox can go back to the tabs', () => {
    expect(isTabPath('/together')).toBe(true);
    expect(isTabPath('/together?friend=a1')).toBe(true);
    expect(isTabPath('/today')).toBe(true);
    expect(isTabPath('/joint/1')).toBe(false);
    expect(isTabPath('/togetherness')).toBe(false);
  });

  test('toInternalPath rejects bare scheme roots', () => {
    expect(toInternalPath('rebufo://')).toBeNull();
    expect(toInternalPath('rebufo-dev://together')).toBe('/together');
  });
});

describe('misc', () => {
  test('unread count and icons', () => {
    expect(unreadCount([notification(), notification({ id: 'n2', readAt: '2026-10-25T10:00:00Z' })])).toBe(1);
    expect(unreadCount(undefined)).toBe(0);
    expect(notificationIcon('kudos')).toBe('heart');
    expect(notificationIcon('joint_invite')).toBe('calendarBadge');
  });
});
