import { describe, expect, test } from '@jest/globals';

import type { IntegrationStatus, PersonalToken, Race } from '@/domain/types';

import { addNote, editNote, joinNoteLines, noteError, noteLines, notesSummary, removeNote } from '../coachNotesModel';
import {
  calendarConnectionView,
  calendarFeedConnectionView,
  claudeConnectionView,
  corosConnectionView,
  garminConnectionView,
  raceCountdown,
} from '../connectionsModel';
import { availabilitySubtitle, raceRow, sportsProfileSubtitle } from '../hubModel';

const TODAY = '2026-10-27';
const NOW = new Date('2026-10-27T12:00:00');

describe('coach notes', () => {
  test('one fact per line, bullets and blanks removed', () => {
    expect(noteLines('Vegetariano\n\n- No nado los lunes\r\n• Rodilla izquierda ')).toEqual(['Vegetariano', 'No nado los lunes', 'Rodilla izquierda']);
    expect(noteLines(null)).toEqual([]);
    expect(noteLines('Clases de 9 a 14 h. Juego al pádel. Tomo 1,6 g/kg de proteína.')).toEqual([
      'Clases de 9 a 14 h.',
      'Juego al pádel.',
      'Tomo 1,6 g/kg de proteína.',
    ]);
    expect(joinNoteLines(['a', ' ', 'b '])).toBe('a\nb');
    expect(joinNoteLines([])).toBeNull();
  });

  test('add / edit / remove are immutable', () => {
    const lines = ['a', 'b'];
    expect(addNote(lines, ' c ')).toEqual(['a', 'b', 'c']);
    expect(editNote(lines, 1, ' B ')).toEqual(['a', 'B']);
    expect(removeNote(lines, 0)).toEqual(['b']);
    expect(lines).toEqual(['a', 'b']);
  });

  test('validation: empty, too long, duplicate (ignoring case), total size', () => {
    expect(noteError('  ', [])).toBe('Escribe algo');
    expect(noteError('x'.repeat(201), [])).toMatch(/Máximo/);
    expect(noteError('VEGETARIANO', ['Vegetariano'])).toBe('Tu coach ya lo sabe');
    expect(noteError('Vegetariano', ['Vegetariano'], 0)).toBeNull();
    expect(noteError('nuevo', Array.from({ length: 20 }, (_, i) => `${i}${'x'.repeat(100)}`))).toMatch(/demasiadas/);
  });
});

describe('connections', () => {
  const garmin = (patch: Partial<IntegrationStatus>): IntegrationStatus => ({
    provider: 'garmin_personal',
    state: 'connected',
    expiresAt: '2027-10-27',
    lastSyncAt: '2026-10-27T10:00:00',
    lastError: null,
    ...patch,
  });

  test('Garmin: connected → sync, expiring/expired → renew, error → fix, none → connect', () => {
    expect(garminConnectionView(garmin({}), TODAY, NOW)).toEqual({
      tone: 'success',
      status: 'Conectado',
      detail: 'Sincronizado hace 2 h',
      action: { kind: 'sync', label: 'Sincronizar' },
    });
    expect(garminConnectionView(garmin({ expiresAt: '2026-10-30' }), TODAY, NOW)).toMatchObject({ tone: 'warning', action: { label: 'Renovar' } });
    expect(garminConnectionView(garmin({ state: 'expired' }), TODAY, NOW)).toMatchObject({ tone: 'danger', status: 'Clave caducada' });
    expect(garminConnectionView(garmin({ state: 'error', lastError: 'Boom' }), TODAY, NOW)).toMatchObject({ detail: 'Boom', action: { label: 'Arreglar' } });
    expect(garminConnectionView(undefined, TODAY, NOW)).toMatchObject({ status: 'Sin conectar', action: { kind: 'open', label: 'Conectar' } });
    expect(garminConnectionView(garmin({ lastSyncAt: null }), TODAY, NOW).detail).toBe('Aún sin sincronizar');
  });

  test('COROS (Apple Salud here): off → connect, waiting → check, connected → sync, iPhone only on the web', () => {
    const health = { available: true, loaded: true, enabled: true, lastSync: '2026-10-27T10:00:00', sources: ['COROS'] };
    expect(corosConnectionView(health, NOW)).toEqual({
      tone: 'success',
      status: 'Conectado',
      detail: 'Sincronizado hace 2 h',
      action: { kind: 'sync', label: 'Sincronizar' },
    });
    expect(corosConnectionView({ ...health, sources: ['Salud'] }, NOW)).toMatchObject({
      tone: 'warning',
      status: 'Esperando datos',
      action: { kind: 'sync', label: 'Comprobar' },
    });
    expect(corosConnectionView({ ...health, enabled: false }, NOW)).toMatchObject({ status: 'Sin conectar', action: { kind: 'open', label: 'Conectar' } });
    expect(corosConnectionView({ ...health, available: false }, NOW)).toMatchObject({ status: 'Solo en iPhone', action: null });
    expect(corosConnectionView({ ...health, loaded: false }, NOW)).toMatchObject({ status: 'Comprobando…', detail: null, action: null });
  });

  test('Claude: connected when an active connector token was used', () => {
    const token: PersonalToken = { id: 't', scope: 'mcp', label: 'Claude', prefix: 'rb', createdAt: '', lastUsedAt: '2026-10-27T11:30:00', revokedAt: null };
    expect(claudeConnectionView([token], NOW)).toMatchObject({ status: 'Conectado', detail: 'Último uso hace 30 min', action: null });
    expect(claudeConnectionView([{ ...token, lastUsedAt: null }], NOW)).toMatchObject({ status: 'Sin conectar', action: { label: 'Conectar' } });
    expect(claudeConnectionView(undefined, NOW).status).toBe('Sin conectar');
  });

  test('training calendar', () => {
    const base = { available: true, enabled: false, permission: 'undetermined' as const, alarmMinutes: 30 };
    expect(calendarConnectionView({ ...base, available: false })).toMatchObject({ status: 'Solo en iPhone', action: null });
    expect(calendarConnectionView({ ...base, enabled: true })).toMatchObject({ status: 'Activado', detail: 'Tus entrenos en tu calendario · aviso 30 min antes' });
    expect(calendarConnectionView({ ...base, permission: 'denied' })).toMatchObject({ status: 'Sin permiso', action: { label: 'Arreglar' } });
    expect(calendarConnectionView(base)).toMatchObject({ status: 'Desactivado', action: { label: 'Activar' } });
  });

  test('race countdown', () => {
    const race = (date: string, priority: Race['priority'] = 'A'): Race =>
      ({ id: date, name: `R ${date}`, date, priority }) as Race;
    expect(raceCountdown([], TODAY)).toBeNull();
    expect(raceCountdown([race('2026-10-01')], TODAY)).toBeNull();
    expect(raceCountdown([race('2026-10-27')], TODAY)).toMatchObject({ days: 0, value: 'Hoy' });
    expect(raceCountdown([race('2026-10-28')], TODAY)).toMatchObject({ value: '1 día' });
    expect(raceCountdown([race('2026-11-05', 'B'), race('2027-04-18')], TODAY)).toMatchObject({ name: 'R 2027-04-18', days: 173 });
  });
});

describe('coach notes summary', () => {
  test('count + first fact, or the nudge when empty', () => {
    expect(notesSummary([])).toMatch(/^Aún nada/);
    expect(notesSummary(['Vegetariano'])).toBe('1 cosa · Vegetariano');
    expect(notesSummary(['Vegetariano', 'No nado los lunes'])).toBe('2 cosas · Vegetariano');
  });
});

describe('calendar feed', () => {
  const token = (patch: Partial<PersonalToken>): PersonalToken => ({
    id: 'x',
    scope: 'ics',
    label: 'Calendario',
    prefix: 'rb',
    createdAt: '2026-10-01T00:00:00Z',
    lastUsedAt: null,
    revokedAt: null,
    ...patch,
  });

  test('counts only active ICS links', () => {
    expect(calendarFeedConnectionView(undefined)).toMatchObject({ tone: 'muted', status: 'Sin enlace', action: null });
    expect(calendarFeedConnectionView([token({ scope: 'mcp' }), token({ revokedAt: '2026-10-02T00:00:00Z' })])).toMatchObject({ status: 'Sin enlace' });
    expect(calendarFeedConnectionView([token({})])).toMatchObject({ tone: 'success', status: 'Activa' });
    expect(calendarFeedConnectionView([token({ id: 'a' }), token({ id: 'b' })])).toMatchObject({ status: '2 enlaces' });
  });
});

describe('Tú hub rows', () => {
  const race = (patch: Partial<Race>): Race =>
    ({ id: 'r', name: 'Valencia', date: '2027-04-18', distance: 'olympic', priority: 'A', ...patch }) as Race;

  test('race row: name, distance and countdown, or the nudge', () => {
    expect(raceRow([], TODAY)).toEqual({ title: 'Añade tu carrera', subtitle: 'El plan se construye hacia ella' });
    expect(raceRow([race({})], TODAY)).toMatchObject({ title: 'Tu carrera', subtitle: expect.stringMatching(/^Valencia · .+ · faltan 173 días$/) });
    expect(raceRow([race({ date: TODAY })], TODAY).subtitle).toMatch(/· es hoy$/);
  });

  test('availability and sport profile subtitles', () => {
    const availability = { weeklyHoursTarget: 9.5, restDay: 6, longSessionDays: [], windows: [], poolDays: [] } as const;
    expect(availabilitySubtitle({ ...availability, longSessionDays: [], windows: [], poolDays: [] })).toBe('9,5 h/semana · descanso el domingo');
    expect(availabilitySubtitle({ ...availability, restDay: null, longSessionDays: [], windows: [], poolDays: [] })).toBe('9,5 h/semana · sin día fijo de descanso');
    expect(sportsProfileSubtitle({ sports: ['swim', 'run'], level: 'beginner' })).toMatch(/^Natación, Carrera · /);
    expect(sportsProfileSubtitle({ sports: [], level: 'advanced' })).not.toContain('·');
  });
});
