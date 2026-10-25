/// <reference types="jest" />
import { addDays } from '@/domain/dates';
import { computeReadiness } from '@/domain/readiness';

import { buildChatReply, detectIntent } from '../demo/coachReply';
import { DEMO_USERS } from '../demo/ids';
import type { CoachContext } from '../demo/rulesCoach';
import { buildSeed } from '../demo/seed';

const TODAY = '2026-10-25';
const WEEK_START = '2026-10-19';

function contextFromSeed(): CoachContext {
  let n = 0;
  const db = buildSeed({ now: '2026-10-25T08:00:00.000Z', today: TODAY, newId: () => `id-${(n += 1)}` });
  const me = DEMO_USERS.diego;
  const mine = <T extends { userId: string }>(rows: T[]) => rows.filter((r) => r.userId === me);
  const profile = db.profiles.find((p) => p.id === me);
  if (!profile) throw new Error('seed without Diego');
  const metrics = mine(db.metrics);
  const checkins = mine(db.checkins);
  const workouts = mine(db.workouts);
  return {
    today: TODAY,
    weekStart: WEEK_START,
    profile,
    races: mine(db.races),
    weekWorkouts: workouts.filter((w) => w.date >= WEEK_START && w.date <= addDays(WEEK_START, 6)),
    lifeEvents: mine(db.lifeEvents),
    busyBlocks: mine(db.busyBlocks),
    jointSessions: [],
    checkins,
    metrics,
    readiness: computeReadiness({ today: TODAY, checkin: null, metrics }),
    recentWeeklyMinutes: [500, 520, 560, 590],
    history: workouts.filter((w) => w.status === 'completed'),
    upcoming: workouts.filter((w) => w.date >= TODAY && w.status === 'planned'),
  };
}

describe('rules coach chat replies', () => {
  it.each([
    ['Me duele la rodilla', 'injury'],
    ['Estoy muy cansado esta semana', 'fatigue'],
    ['Mañana tengo partido de pádel', 'other_sport'],
    ['¿Qué como antes de la tirada larga?', 'nutrition'],
    ['¿Puedes reorganizar la semana?', 'plan'],
    ['Hola', 'general'],
  ])('detects intent of "%s"', (message, intent) => {
    expect(detectIntent(message)).toBe(intent);
  });

  it('builds a Spanish status reply from the context', () => {
    const reply = buildChatReply({ message: 'Hola', ctx: contextFromSeed() });
    expect(reply).toContain('Diego');
    expect(reply).toContain('Esta semana llevas');
    expect(reply).toContain('Faltan 168 días');
    expect(reply).toContain('Tu próxima sesión');
  });

  it('adds a safety note for pain and fueling tips for nutrition', () => {
    const ctx = contextFromSeed();
    expect(buildChatReply({ message: 'me duele el tendón', ctx })).toContain('consulta a un profesional');
    expect(buildChatReply({ message: 'qué comer', ctx })).toContain('no es consejo médico');
  });
});
