import { describe, expect, test } from '@jest/globals';

import type { Friend } from '@/domain/types';

import { MAX_FRIEND_IDS, friendIdsForConversation, friendIdsMentioned } from '../friendMentions';

function friend(id: string, displayName: string, username: string, status: Friend['status'] = 'accepted'): Friend {
  return {
    friendshipId: `fs-${id}`,
    profile: { id, username, displayName, avatarUrl: null, sports: [] },
    status,
    direction: status === 'accepted' ? 'mutual' : 'incoming',
    visibility: status === 'accepted' ? 'full' : null,
    createdAt: '2026-10-01T10:00:00.000Z',
  };
}

const DAVID = friend('david-id', 'David Molina', 'davidm');
const ALEX = friend('alex-id', 'Álex García', 'alex_g');
const LUCIA = friend('lucia-id', 'Lucía', 'lucia', 'pending');
const FRIENDS = [DAVID, ALEX, LUCIA];

describe('friendIdsMentioned', () => {
  test.each([
    ['quiero rodar con David el sábado', ['david-id']],
    ['¿Puedo entrenar con DAVID MOLINA?', ['david-id']],
    ['busca hueco con @davidm', ['david-id']],
    ['y con davidm?', ['david-id']],
    ['quedar con alex y con David', ['david-id', 'alex-id']],
    ['salgo en bici con Álex', ['alex-id']],
    ['nado con alex_g', ['alex-id']],
  ])('names: %s', (message, ids) => {
    expect(friendIdsMentioned(message, FRIENDS)).toEqual(ids);
  });

  test('whole words only: no match inside other words', () => {
    expect(friendIdsMentioned('Davidson corre mañana', FRIENDS)).toEqual([]);
    expect(friendIdsMentioned('alexa, pon música', FRIENDS)).toEqual([]);
    expect(friendIdsMentioned('me quedaré en casa', FRIENDS)).toEqual([]);
  });

  test('generic words mean every accepted friend (pending ones never)', () => {
    for (const message of ['¿Cuándo puedo entrenar con mis amigos?', 'Busca una quedada', 'queremos entrenar juntos', 'con mi compañero de piso', 'con una amiga', 'Quedamos el domingo?']) {
      expect(friendIdsMentioned(message, FRIENDS)).toEqual(['david-id', 'alex-id']);
    }
    expect(friendIdsMentioned('quedar con Lucía', FRIENDS)).toEqual(['david-id', 'alex-id']);
  });

  test('a named friend wins over the generic words', () => {
    expect(friendIdsMentioned('quiero quedar con David para entrenar juntos', FRIENDS)).toEqual(['david-id']);
  });

  test('nothing for unrelated messages, empty text or no friends', () => {
    expect(friendIdsMentioned('me duele la rodilla', FRIENDS)).toEqual([]);
    expect(friendIdsMentioned('   ', FRIENDS)).toEqual([]);
    expect(friendIdsMentioned('con mis amigos', [])).toEqual([]);
  });

  test(`at most ${MAX_FRIEND_IDS} friends`, () => {
    const many = Array.from({ length: 8 }, (_, i) => friend(`id-${i}`, `Amigo${i}`, `amigo${i}`));
    expect(friendIdsMentioned('entrenar juntos', many)).toHaveLength(MAX_FRIEND_IDS);
  });

  test('a one-letter name never matches on its own', () => {
    expect(friendIdsMentioned('voy a correr', [friend('a-id', 'A', 'aa')])).toEqual([]);
  });
});

describe('friendIdsForConversation', () => {
  test('a follow-up that names nobody keeps the friends of the previous message', () => {
    expect(friendIdsForConversation('¿y el domingo?', ['quiero rodar con David'], FRIENDS)).toEqual(['david-id']);
    expect(friendIdsForConversation('con Álex mejor', ['quiero rodar con David'], FRIENDS)).toEqual(['alex-id']);
  });

  test('only looks back a couple of messages', () => {
    expect(friendIdsForConversation('¿y el domingo?', ['con David', 'me duele', 'otra cosa'], FRIENDS)).toEqual([]);
    expect(friendIdsForConversation('hola', [], FRIENDS)).toEqual([]);
  });
});
