/// <reference types="jest" />
import { detectPlanAction, detectWeekPlanRequest, requestedWeekStart } from '../demo/coachIntents';
import { chatPlanRequest } from '../demo/rulesCoach';

/** Tuesday 10 Nov 2026 (this week starts on Monday 9 Nov). */
const TODAY = '2026-11-10';

describe('explicit plan requests in the chat', () => {
  it.each([
    ['Planifícame la semana', 'plan_week'],
    ['¿Me preparas la semana que viene?', 'plan_week'],
    ['Hazme el plan de la semana', 'plan_week'],
    ['Organiza mi semana, porfa', 'plan_week'],
    ['Reorganiza mi semana', 'replan'],
    ['¿Puedes reorganizar la semana?', 'replan'],
    ['Replanifica, que me ha surgido un viaje', 'replan'],
    ['Ajusta el plan, hoy no llego', 'replan'],
    ['¿Cómo va mi semana?', null],
    ['Tengo la semana preparada', null],
    ['¿Qué toca hoy?', null],
  ])('"%s" → %s', (message, action) => {
    expect(detectPlanAction(message)).toBe(action);
  });

  it('plans next week when the message says so, else the requested one', () => {
    expect(requestedWeekStart('planifícame la semana que viene', '2026-11-09', TODAY)).toBe('2026-11-16');
    expect(requestedWeekStart('planifícame la semana', '2026-11-12', TODAY)).toBe('2026-11-09');
    // On a Sunday this week is over: "la semana" means the next one, unless they say "esta semana".
    expect(requestedWeekStart('planifícame la semana', '2026-11-09', '2026-11-15')).toBe('2026-11-16');
    expect(requestedWeekStart('reorganiza esta semana', '2026-11-09', '2026-11-15')).toBe('2026-11-09');
  });

  it('turns a chat request into plan_week / replan for that week; anything else stays a chat', () => {
    const chat = { mode: 'chat' as const, weekStart: '2026-11-09' };
    expect(chatPlanRequest({ ...chat, message: 'Prepárame la próxima semana' }, TODAY)).toMatchObject({ mode: 'plan_week', weekStart: '2026-11-16' });
    expect(chatPlanRequest({ ...chat, message: 'Reorganiza la semana' }, TODAY)).toMatchObject({ mode: 'replan', weekStart: '2026-11-09' });
    expect(chatPlanRequest({ ...chat, message: '¿Qué toca hoy?' }, TODAY)).toEqual({ ...chat, message: '¿Qué toca hoy?' });
    // A season-plan request ("de descarga") is not a request to detail the week.
    expect(chatPlanRequest({ ...chat, message: 'Hazme la semana que viene de descarga' }, TODAY).mode).toBe('chat');
    expect(chatPlanRequest({ mode: 'replan', weekStart: '2026-11-09', message: 'Planifícame la semana' }, TODAY).mode).toBe('replan');
  });
});

describe('season plan requests ("pon la semana del 23 de descarga")', () => {
  it.each([
    ['Pon la semana del 23 de descarga', { weekStart: '2026-11-23', kind: 'recovery' }],
    ['La semana que viene quiero semana libre, me voy de viaje', { weekStart: '2026-11-16', kind: 'rest' }],
    ['Dentro de 3 semanas hazme una semana fuerte, con más volumen', { weekStart: '2026-11-30', kind: 'push' }],
    ['Marca la semana del 7 de diciembre como semana de carga', { weekStart: '2026-12-07', kind: 'load' }],
    ['Esta semana necesito descarga', { weekStart: '2026-11-09', kind: 'recovery' }],
  ])('"%s"', (message, expected) => {
    expect(detectWeekPlanRequest(message, TODAY)).toEqual(expected);
  });

  it.each([
    ['¿Qué es una semana de descarga?'],
    ['Pon la semana de descarga'],
    ['Pon la semana que viene más tranquila'],
  ])('ignores "%s" (no clear week, kind or request)', (message) => {
    expect(detectWeekPlanRequest(message, TODAY)).toBeNull();
  });
});
