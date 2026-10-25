/** Pure state helpers for the "Ha surgido algo" form (unit-tested). */
import {
  BODY_AREAS,
  LIFE_EVENT_KINDS,
  type BodyArea,
  type ISODate,
  type ISOTime,
  type LifeEvent,
  type LifeEventDraft,
  type LifeEventKind,
  type Severity,
} from '@/domain/types';

import { hasTime, kindGroup } from './kinds';

export interface EventFormState {
  kind: LifeEventKind;
  /** Custom title; empty = use the kind label. */
  title: string;
  startDate: ISODate;
  endDate: ISODate;
  startTime: ISOTime | null;
  durationMin: number;
  severity: Severity;
  bodyArea: BodyArea | null;
  notes: string;
}

const DEFAULT_SPORT_DURATION = 90;

export function isLifeEventKind(value: unknown): value is LifeEventKind {
  return typeof value === 'string' && (LIFE_EVENT_KINDS as readonly string[]).includes(value);
}

export function isBodyArea(value: unknown): value is BodyArea {
  return typeof value === 'string' && (BODY_AREAS as readonly string[]).includes(value);
}

export function emptyEventForm(date: ISODate, kind: LifeEventKind = 'padel'): EventFormState {
  return {
    kind,
    title: '',
    startDate: date,
    endDate: date,
    startTime: kindGroup(kind) === 'sport' ? '19:00' : null,
    durationMin: DEFAULT_SPORT_DURATION,
    severity: 2,
    bodyArea: null,
    notes: '',
  };
}

export function eventToForm(e: LifeEvent, kindLabel: (k: LifeEventKind) => string): EventFormState {
  return {
    kind: e.kind,
    title: e.title === kindLabel(e.kind) ? '' : e.title,
    startDate: e.startDate,
    endDate: e.endDate || e.startDate,
    startTime: e.startTime,
    durationMin: e.durationMin ?? DEFAULT_SPORT_DURATION,
    severity: e.severity,
    bodyArea: e.bodyArea,
    notes: e.notes ?? '',
  };
}

/** Changing kind keeps dates/notes and sets sensible defaults for the new field set. */
export function changeKind(state: EventFormState, kind: LifeEventKind): EventFormState {
  const group = kindGroup(kind);
  return {
    ...state,
    kind,
    endDate: group === 'sport' ? state.startDate : state.endDate,
    startTime: hasTime(kind) ? (state.startTime ?? (group === 'sport' ? '19:00' : null)) : null,
    bodyArea: group === 'injury' ? state.bodyArea : null,
  };
}

/** Keeps endDate ≥ startDate when the start moves. */
export function changeStartDate(state: EventFormState, startDate: ISODate): EventFormState {
  const single = kindGroup(state.kind) === 'sport';
  return { ...state, startDate, endDate: single || state.endDate < startDate ? startDate : state.endDate };
}

export function formToEventDraft(state: EventFormState, kindLabel: (k: LifeEventKind) => string): LifeEventDraft {
  const group = kindGroup(state.kind);
  const notes = state.notes.trim();
  return {
    kind: state.kind,
    title: state.title.trim() || kindLabel(state.kind),
    startDate: state.startDate,
    endDate: group === 'sport' ? state.startDate : state.endDate,
    startTime: hasTime(state.kind) ? state.startTime : null,
    durationMin: group === 'sport' ? Math.max(0, Math.round(state.durationMin)) : null,
    severity: state.severity,
    bodyArea: group === 'injury' ? state.bodyArea : null,
    notes: notes ? notes : null,
  };
}
