import type { CoachResponse, LifeEvent, PlanProposal, Workout } from '@/domain/types';

export function makeWorkout(overrides: Partial<Workout> = {}): Workout {
  return {
    id: 'w1',
    userId: 'me',
    date: '2026-10-27',
    startTime: '18:30',
    sport: 'run',
    title: 'Rodaje',
    description: null,
    durationMin: 60,
    distanceM: null,
    intensity: 'endurance',
    tss: null,
    steps: [],
    status: 'planned',
    completed: null,
    source: 'manual',
    isKey: false,
    jointSessionId: null,
    externalId: null,
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
    ...overrides,
  };
}

export function makeProposal(overrides: Partial<PlanProposal> = {}): PlanProposal {
  return {
    id: 'p1',
    userId: 'me',
    kind: 'replan',
    source: 'rules',
    weekStart: '2026-10-26',
    summary: 'Ajuste por pádel',
    changes: [],
    status: 'pending',
    model: null,
    createdAt: '2026-10-25T10:00:00.000Z',
    ...overrides,
  };
}

export function makeCoachResponse(overrides: Partial<CoachResponse> = {}): CoachResponse {
  return { reply: 'Hecho', proposal: null, engine: 'ai', memory: [], lifeEvent: null, ...overrides };
}

export function makeLifeEvent(overrides: Partial<LifeEvent> = {}): LifeEvent {
  return {
    id: 'e1',
    userId: 'me',
    kind: 'injury',
    title: 'Esguince de tobillo',
    startDate: '2026-10-27',
    endDate: '2026-11-02',
    startTime: null,
    durationMin: null,
    severity: 2,
    bodyArea: 'ankle',
    notes: null,
    createdAt: '2026-10-27T10:00:00.000Z',
    ...overrides,
  };
}
