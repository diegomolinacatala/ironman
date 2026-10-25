import * as L from '../labels';
import { BODY_AREAS, INTENSITIES, LIFE_EVENT_KINDS, MEAL_SLOTS, RACE_DISTANCES, SPORTS } from '../types';

describe('labels', () => {
  test('every enum value has a non-empty Spanish label', () => {
    for (const s of SPORTS) expect(L.sportLabel(s)).not.toBe('');
    for (const i of INTENSITIES) {
      expect(L.intensityLabel(i)).not.toBe('');
      expect(L.intensityZone(i)).toMatch(/^(Z[1-5]|RC)$/);
      expect(L.difficultyLabel(i)).not.toBe('');
    }
    for (const d of RACE_DISTANCES) expect(L.raceDistanceLabel(d)).not.toBe('');
    for (const k of LIFE_EVENT_KINDS) expect(L.lifeEventLabel(k)).not.toBe('');
    for (const a of BODY_AREAS) expect(L.bodyAreaLabel(a)).not.toBe('');
    for (const m of MEAL_SLOTS) expect(L.mealLabel(m)).not.toBe('');
  });

  test('specific copy from the contract', () => {
    expect(L.intensityLabel('endurance')).toBe('Fondo Z2');
    expect(L.intensityLabel('race')).toBe('Ritmo carrera');
    expect(L.intensityZone('race')).toBe('RC');
    expect(L.difficultyLabel('vo2')).toBe('Muy dura');
    expect(L.raceDistanceLabel('half')).toBe('Media distancia');
    expect(L.raceDistanceLabel('full')).toBe('Distancia completa');
    expect(L.raceDistanceDetail('half')).toBe('1,9 · 90 · 21,1 km');
    expect(L.raceDistanceDetail('other')).toBe('');
  });

  test('trademark-safe race names', () => {
    for (const d of RACE_DISTANCES) {
      expect(L.raceDistanceLabel(d)).not.toMatch(/ironman|70\.3/i);
    }
  });

  test('severity depends on the kind of event', () => {
    expect(L.severityLabel('padel', 3)).toBe('Muy intenso');
    expect(L.severityLabel('injury', 1)).toMatch(/Leve/);
    expect(L.severityLabel('illness', 3)).toMatch(/fiebre/);
    expect(L.severityLabel('exam', 2)).toBe('Alto');
    expect(L.severityLabel('travel', 1)).toBe('Corto');
    expect(L.severityLabel('other', 2)).toBe('Medio');
  });

  test('visibility, level, status and phase labels', () => {
    expect(L.visibilityLabel('busy')).toBe('Solo ocupado');
    expect(L.visibilityHelp('summary')).toMatch(/no títulos/);
    expect(L.levelLabel('beginner')).toBe('Principiante');
    expect(L.statusLabel('completed')).toBe('Hecho');
    expect(L.jointStatusLabel('confirmed')).toBe('Confirmada');
    expect(L.participantStatusLabel('declined')).toBe('No puede');
    expect(L.proposalStatusLabel('partially_applied')).toBe('Aplicada en parte');
    expect(L.complianceLabel('adjusted')).toBe('Ajustado');
    expect(L.readinessLabel('amber')).toBe('Con precaución');
    expect(L.phaseLabel('race_week')).toBe('Semana de carrera');
    expect(L.phaseLabel('taper')).toBe('Puesta a punto');
  });

  test('weekday labels', () => {
    expect(L.weekdayLabel(0)).toBe('Lunes');
    expect(L.weekdayShort(6)).toBe('Dom');
    expect(L.weekdayInitial(2)).toBe('X');
  });
});
