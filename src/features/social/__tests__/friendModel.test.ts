import { describe, expect, test } from '@jest/globals';

import { ALEX, friend, ME } from '@/features/together/__tests__/fixtures';

import { findAcceptedFriend, firstName, relationTo, splitFriends } from '../friendModel';

describe('relationTo', () => {
  test('maps friendships to search actions', () => {
    expect(relationTo(ME, [], ME)).toEqual({ kind: 'self' });
    expect(relationTo(ALEX, [], ME)).toEqual({ kind: 'none' });
    expect(relationTo(ALEX, [friend()], ME)).toEqual({ kind: 'friends', friendshipId: 'fs1' });
    expect(relationTo(ALEX, [friend({ status: 'pending', direction: 'incoming' })], ME)).toEqual({ kind: 'incoming', friendshipId: 'fs1' });
    expect(relationTo(ALEX, [friend({ status: 'pending', direction: 'outgoing' })], ME)).toEqual({ kind: 'outgoing', friendshipId: 'fs1' });
    expect(relationTo(ALEX, [friend({ status: 'declined' })], ME)).toEqual({ kind: 'none' });
    expect(relationTo(ALEX, [friend({ status: 'blocked' })], ME)).toEqual({ kind: 'none' });
  });
});

describe('splitFriends', () => {
  test('splits by status and direction, sorted by name', () => {
    const split = splitFriends([
      friend({ friendshipId: 'z' }, { id: 'z', displayName: 'Zoe' }),
      friend({ friendshipId: 'a' }, { id: 'a', displayName: 'Álex' }),
      friend({ friendshipId: 'in', status: 'pending', direction: 'incoming' }, { id: 'in' }),
      friend({ friendshipId: 'out', status: 'pending', direction: 'outgoing' }, { id: 'out' }),
    ]);
    expect(split.accepted.map((f) => f.friendshipId)).toEqual(['a', 'z']);
    expect(split.incoming.map((f) => f.friendshipId)).toEqual(['in']);
    expect(split.outgoing.map((f) => f.friendshipId)).toEqual(['out']);
    expect(splitFriends(undefined)).toEqual({ accepted: [], incoming: [], outgoing: [] });
  });
});

describe('lookups', () => {
  test('findAcceptedFriend only returns accepted friends', () => {
    expect(findAcceptedFriend([friend()], ALEX)?.friendshipId).toBe('fs1');
    expect(findAcceptedFriend([friend({ status: 'pending' })], ALEX)).toBeNull();
    expect(findAcceptedFriend([friend()], undefined)).toBeNull();
  });

  test('firstName', () => {
    expect(firstName('Álex García')).toBe('Álex');
    expect(firstName('  Diego ')).toBe('Diego');
    expect(firstName('')).toBe('');
  });
});
