/// <reference types="jest" />
import { addDays, startOfWeek } from '@/domain/dates';
import { computeReadiness } from '@/domain/readiness';

import { buildChatReply, detectIntent, weekPlanSuggestion, zoneSports } from '../demo/coachReply';
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
    weekPlans: mine(db.weekPlans),
  };
}

/** Phrases the v3 coach used for buttons the chat no longer has. */
const STALE_COPY = /botones de abajo|Replanificar/;

describe('rules coach chat replies', () => {
  it.each([
    ['Me duele la rodilla', 'injury'],
    ['Estoy muy cansado esta semana', 'fatigue'],
    ['Mañana tengo partido de pádel', 'other_sport'],
    ['¿Qué como antes de la tirada larga?', 'nutrition'],
    ['¿Puedes reorganizar la semana?', 'plan'],
    ['Hola', 'general'],
    ['¿Qué toca hoy?', 'today'],
    ['¿A qué pulsaciones hago el rodaje?', 'zones'],
    ['¿Cuántos vatios en las series?', 'zones'],
    ['¿Cómo llego a la carrera?', 'season'],
    ['¿Qué tal pinta el plan general?', 'season'],
    ['Tengo agujetas de ayer', 'fatigue'],
    ['He dormido fatal, ¿qué hago hoy?', 'fatigue'],
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

describe('rules coach chat replies as a coach (v4)', () => {
  it('«¿Qué toca hoy?» names today’s session with its target and sensations', () => {
    const ctx = contextFromSeed();
    const today = ctx.upcoming.find((w) => w.date === TODAY && w.sport !== 'rest');
    const reply = buildChatReply({ message: '¿Qué toca hoy?', ctx });
    expect(today).toBeDefined();
    expect(reply).toContain(`«${today?.title}» hoy`);
    expect(reply).toContain('Sensaciones:');
    expect(reply).toMatch(/ppm|\/km|W ·|RPE/);
    expect(reply).not.toMatch(STALE_COPY);
  });

  it('a rest day says so and points to the next session', () => {
    const base = contextFromSeed();
    const ctx = { ...base, weekWorkouts: base.weekWorkouts.filter((w) => w.date !== TODAY), upcoming: base.upcoming.filter((w) => w.date !== TODAY) };
    const reply = buildChatReply({ message: '¿qué toca hoy?', ctx });
    expect(reply).toContain('Hoy no tienes entreno');
    expect(reply).toContain('Tu próxima sesión');
  });

  it('answers zones with the athlete’s numbers, and says what is missing', () => {
    const ctx = contextFromSeed();
    const bike = buildChatReply({ message: '¿A qué vatios hago las series de bici?', ctx });
    expect(bike).toContain('Bici:');
    expect(bike).toMatch(/\d+–\d+ W/);
    expect(bike).not.toContain('Natación:');
    const noThresholds = { ...ctx, profile: { ...ctx.profile, thresholds: {} } };
    expect(buildChatReply({ message: '¿Cuáles son mis zonas?', ctx: noThresholds })).toContain('Tú › Perfil');
  });

  it.each([
    ['¿a qué pulsaciones?', ['run', 'bike']],
    ['¿qué ritmo en la piscina?', ['swim']],
    ['¿a qué ritmo hago el rodaje?', ['run']],
    ['mis zonas', ['run', 'bike', 'swim']],
  ])('zones for "%s"', (message, sports) => {
    expect(zoneSports(message)).toEqual(sports);
  });

  it('tired or sore → plan B and an easier version, no stale buttons', () => {
    const ctx = contextFromSeed();
    for (const message of ['Estoy reventado', 'Tengo agujetas', 'He dormido fatal']) {
      const reply = buildChatReply({ message, ctx });
      expect(reply).toContain('Versión suave:');
      expect(reply).toContain('reorganiza mi semana');
      expect(reply).not.toMatch(STALE_COPY);
    }
  });

  it('the season plan: summary, the next weeks and where to adjust them', () => {
    const reply = buildChatReply({ message: '¿Cómo llego a la carrera? ¿Qué toca las próximas semanas?', ctx: contextFromSeed() });
    expect(reply).toContain('Lo próximo:');
    expect(reply).toContain('Esta semana:');
    expect(reply).toContain('Plan › General');
  });

  it('plan and injury replies explain how to ask in the chat', () => {
    const ctx = contextFromSeed();
    const plan = buildChatReply({ message: '¿Cómo organizo la semana?', ctx });
    expect(plan).toContain('«planifícame la semana»');
    expect(plan).not.toMatch(STALE_COPY);
    const injury = buildChatReply({ message: 'Me duele la rodilla', ctx, injuryLogged: true });
    expect(injury).toContain('reorganiza mi semana');
    expect(injury).not.toMatch(STALE_COPY);
  });
});

describe('season plan suggestions from the chat', () => {
  it('suggests an editable week as an ai_coach draft', () => {
    const suggestion = weekPlanSuggestion({ weekStart: '2026-11-09', kind: 'recovery' }, contextFromSeed());
    expect(suggestion.draft).toEqual({ weekStart: '2026-11-09', kind: 'recovery', targetMinutes: null, note: null, source: 'ai_coach' });
    expect(suggestion.reply).toContain('«Descarga»');
  });

  it('never touches the week of the target race', () => {
    const ctx = contextFromSeed();
    const race = ctx.races.find((r) => r.priority === 'A');
    const raceWeek = race ? startOfWeek(race.date) : '';
    const suggestion = weekPlanSuggestion({ weekStart: raceWeek, kind: 'push' }, ctx);
    expect(suggestion.draft).toBeNull();
    expect(suggestion.reply).toContain('no conviene cambiarla');
  });
});
