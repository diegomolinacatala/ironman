import { describe, expect, test } from '@jest/globals';

import { ALEX, feedItem, ME } from '@/features/together/__tests__/fixtures';

import { describeFeedItem } from '../feedText';

const TODAY = '2026-10-25';

describe('describeFeedItem', () => {
  test('workout completed by a friend', () => {
    expect(describeFeedItem(feedItem(), ME, TODAY)).toEqual({
      actor: 'Álex',
      action: 'completó Rodaje Z2',
      detail: "1h 10' · 12,5 km",
      sport: 'run',
    });
  });

  test('summary visibility (no title) and second person for me', () => {
    const text = describeFeedItem(feedItem({ payload: { sport: 'swim', durationMin: 45 } }), ME, TODAY);
    expect(text.action).toBe('completó un entreno de natación');
    expect(text.detail).toBe("45'");
    const mine = describeFeedItem(feedItem({ actor: { ...feedItem().actor, id: ME } }), ME, TODAY);
    expect(mine.actor).toBe('Tú');
    expect(mine.action).toBe('completaste Rodaje Z2');
  });

  test('defensive against malformed payloads', () => {
    const text = describeFeedItem(feedItem({ payload: { sport: 'curling', durationMin: 'mucho', title: '  ' } }), ME, TODAY);
    expect(text).toEqual({ actor: 'Álex', action: 'completó un entreno', detail: null, sport: null });
  });

  test('race added, joint confirmed and plan updated', () => {
    expect(
      describeFeedItem(feedItem({ type: 'race_added', payload: { name: 'Media de Valencia', distance: 'half', date: '2027-04-18' } }), ME, TODAY).action,
    ).toBe('añadió una carrera: Media de Valencia');
    const joint = describeFeedItem(feedItem({ type: 'joint_confirmed', payload: { title: 'Rodaje largo', date: '2026-10-26', sport: 'run' } }), ME, TODAY);
    expect(joint.action).toBe('confirmó la quedada «Rodaje largo»');
    expect(joint.detail).toBe('Mañana');
    expect(describeFeedItem(feedItem({ type: 'plan_updated', payload: {} }), ALEX, TODAY).action).toBe('actualizaste tu plan de la semana');
  });

  test('falls back to the username when there is no display name', () => {
    const item = feedItem({ actor: { ...feedItem().actor, displayName: '' } });
    expect(describeFeedItem(item, null, TODAY).actor).toBe('@alex');
  });
});
