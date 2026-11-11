/**
 * COROS through Apple Salud: what to tell the athlete after an import and the
 * status shown in Conexiones (pure, unit-tested).
 */
import type { HealthSyncResult } from '@/integrations/health/result';

import { joinEs } from '../onboarding/connectModel';
import { formatRelativeTime } from './format';
import type { StatusTone } from './garminModel';

const COROS_SOURCE_RE = /coros/i;

/** HealthKit source written by the COROS app. */
export function isCorosSource(name: string): boolean {
  return COROS_SOURCE_RE.test(name);
}

export function hasCorosSource(sources: readonly string[] | null | undefined): boolean {
  return (sources ?? []).some(isCorosSource);
}

/** "12 entrenos y 26 noches de sueño" (null when nothing came). */
export function importedLine(result: Pick<HealthSyncResult, 'activitiesFound' | 'sleepNights'>): string | null {
  const parts: string[] = [];
  if (result.activitiesFound > 0) parts.push(result.activitiesFound === 1 ? '1 entreno' : `${result.activitiesFound} entrenos`);
  if (result.sleepNights > 0) parts.push(result.sleepNights === 1 ? '1 noche de sueño' : `${result.sleepNights} noches de sueño`);
  return parts.length > 0 ? joinEs(parts) : null;
}

export interface CorosImportView {
  /** COROS data seen in Apple Salud, or still waiting for the first sync. */
  kind: 'seen' | 'waiting';
  title: string;
  message: string;
}

/**
 * After reading Apple Salud: «COROS conectado» with what came, or «Aún no vemos datos de
 * COROS» (normal at first: COROS only sends what is new). `known` = sources seen before.
 */
export function corosImportView(result: HealthSyncResult | null, known: readonly string[] = []): CorosImportView {
  const line = result ? importedLine(result) : null;
  if (hasCorosSource(result?.sources) || hasCorosSource(known)) {
    return {
      kind: 'seen',
      title: 'COROS conectado',
      message: line
        ? `${line.charAt(0).toUpperCase()}${line.slice(1)} de tus últimas 4 semanas.`
        : 'Tus entrenos y tu sueño llegarán cada vez que la app COROS sincronice tu reloj.',
    };
  }
  return {
    kind: 'waiting',
    title: 'Aún no vemos datos de COROS',
    message: line
      ? `De momento hemos traído ${line} de Apple Salud, pero nada de COROS.`
      : 'Es normal al principio: COROS solo pasa a Salud lo nuevo. Tras tu próximo entreno, o mañana al despertar, abre la app COROS y llegará solo.',
  };
}

export type CorosState = 'checking' | 'unavailable' | 'off' | 'waiting' | 'connected';

export interface CorosStatusView {
  state: CorosState;
  tone: StatusTone;
  label: string;
  detail: string;
}

export interface CorosHealthLike {
  available: boolean;
  loaded: boolean;
  enabled: boolean;
  lastSync: string | null;
  sources: readonly string[];
}

/** COROS card / Conexiones row: Apple Salud off, waiting for COROS data, or connected with the last read. */
export function corosStatusView(health: CorosHealthLike, now: Date = new Date()): CorosStatusView {
  if (!health.available) {
    return { state: 'unavailable', tone: 'muted', label: 'Solo en iPhone', detail: 'Tu COROS llega por Apple Salud, en la app del iPhone.' };
  }
  if (!health.loaded) return { state: 'checking', tone: 'muted', label: 'Comprobando…', detail: 'Mirando Apple Salud.' };
  if (!health.enabled) {
    return { state: 'off', tone: 'muted', label: 'Sin conectar', detail: 'Tus entrenos, tu sueño y tu pulso de COROS, solos.' };
  }
  if (!hasCorosSource(health.sources)) {
    return { state: 'waiting', tone: 'warning', label: 'Esperando datos', detail: 'Abre la app COROS con el reloj cerca para que sincronice.' };
  }
  const read = health.lastSync ? `Última lectura ${formatRelativeTime(health.lastSync, now)}` : 'Aún sin leer';
  return { state: 'connected', tone: 'success', label: 'Conectado', detail: `${read} · por Apple Salud` };
}

export type CorosStepPhase = 'checking' | 'unavailable' | 'intro' | 'connecting' | 'seen' | 'waiting' | 'simulated';

export interface CorosStepInput {
  available: boolean;
  isDemo: boolean;
  loaded: boolean;
  enabled: boolean;
  /** A connect or a read is in flight. */
  working: boolean;
  /** Demo without Apple Salud (web): the success is simulated. */
  simulated: boolean;
  result: HealthSyncResult | null;
  /** A read of Apple Salud finished in this visit (even if it failed and left no result). */
  attempted: boolean;
  /** Sources seen in earlier syncs on this device. */
  known: readonly string[];
}

/** Onboarding "Tu reloj" › COROS: which state to show. */
export function corosStepPhase(input: CorosStepInput): CorosStepPhase {
  if (input.simulated) return 'simulated';
  if (!input.available) return input.isDemo ? 'intro' : 'unavailable';
  if (!input.loaded) return 'checking';
  if (input.working) return 'connecting';
  if (!input.enabled) return 'intro';
  // Enabled but not read in this visit yet: the first read is about to start.
  if (!input.result && !input.attempted) return 'connecting';
  return corosImportView(input.result, input.known).kind;
}

/** Apple Salud is on (or simulated in the demo): the "Tu reloj" step is done for a COROS athlete. */
export function isCorosStepDone(phase: CorosStepPhase): boolean {
  return phase === 'seen' || phase === 'waiting' || phase === 'simulated';
}

/** What the demo pretends to have read (web, no Apple Salud). */
export const SIMULATED_COROS_MESSAGE = 'Modo demo: simulamos que COROS ha traído 12 entrenos y 26 noches de sueño de tus últimas 4 semanas.';
