/**
 * React hooks for the settings screens (Apple Salud, Calendario, Notificaciones).
 * Web-safe: the native modules report "unavailable" / "denied" there.
 *
 * Device opt-ins are per account: every read/write is keyed by the signed-in
 * user id, so switching accounts shows (and syncs) only that account's choices.
 *
 * Actions throw `Error`s with Spanish messages; screens show them with `errorMessage()`.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { AppState } from 'react-native';

import { useAuth, useRepository } from '@/data/context';
import { logger } from '@/lib/logger';

import {
  getCalendarLastSync,
  getCalendarPermission,
  getSelectedCalendarIds,
  listDeviceCalendars,
  requestCalendarPermission,
  setSelectedCalendarIds,
  syncCalendarBusy,
  type DeviceCalendar,
  type PermissionState,
} from './calendar';
import type { HealthSyncResult } from './health/result';
import { getHealthLastSync, getHealthSources, isHealthEnabled, setHealthEnabled } from './health/state';
import { isHealthAvailable, requestHealthPermissions, syncHealth } from './healthkit';
import { getNotificationPermission, registerForPush, requestNotificationPermission } from './notifications';

export type { HealthSyncResult } from './health/result';

const HEALTH_QUERY_ROOTS = ['metrics', 'workouts', 'workout', 'feed', 'friend_week'] as const;
const CALENDAR_QUERY_ROOTS = ['busy_blocks', 'friend_week'] as const;
const SIGNED_OUT_MESSAGE = 'Inicia sesión para conectar tus integraciones.';

function useInvalidateRoots(): (roots: readonly string[]) => Promise<void> {
  const client = useQueryClient();
  return useCallback(
    async (roots: readonly string[]) => {
      await Promise.all(roots.map((root) => client.invalidateQueries({ queryKey: [root] })));
    },
    [client],
  );
}

function useUserId(): string | null {
  return useAuth().session?.userId ?? null;
}

/** The first import reads 4 weeks (Garmin and COROS onboarding promise the same). */
export const FIRST_HEALTH_IMPORT_DAYS = 28;

export interface HealthSyncOptions {
  /** Days to read back (default 14; capped at 60). */
  days?: number;
}

export interface HealthIntegration {
  available: boolean;
  /** This account's opt-in has been read from the device: until then `enabled` means nothing. */
  loaded: boolean;
  enabled: boolean;
  lastSync: string | null;
  /** Apps seen writing workouts or sleep to Apple Salud for this account ("COROS"…). */
  sources: string[];
  busy: boolean;
  /** Permission sheet + opt-in + first import (4 weeks unless `days`). Null when that import failed. */
  connect(opts?: HealthSyncOptions): Promise<HealthSyncResult | null>;
  syncNow(opts?: HealthSyncOptions): Promise<HealthSyncResult>;
  disable(): Promise<void>;
}

interface HealthDeviceState {
  loaded: boolean;
  enabled: boolean;
  lastSync: string | null;
  sources: string[];
}

const UNREAD: HealthDeviceState = { loaded: false, enabled: false, lastSync: null, sources: [] };
const SIGNED_OUT_HEALTH: HealthDeviceState = { ...UNREAD, loaded: true };

async function readHealthState(userId: string | null): Promise<HealthDeviceState> {
  if (!userId) return SIGNED_OUT_HEALTH;
  const [enabled, lastSync, sources] = await Promise.all([isHealthEnabled(userId), getHealthLastSync(userId), getHealthSources(userId)]);
  return { loaded: true, enabled, lastSync, sources };
}

type SetHealthState = Dispatch<SetStateAction<HealthDeviceState>>;

/** Reads this account's Apple Salud opt-in (again when the account changes). */
function useHealthDeviceState(userId: string | null): readonly [HealthDeviceState, SetHealthState] {
  const [state, setState] = useState<HealthDeviceState>(UNREAD);
  useEffect(() => {
    let active = true;
    // Another account must never see the previous one's opt-in, even for a frame.
    setState(UNREAD);
    // One retry before reporting "not enabled": a transient storage error must not send a COROS
    // athlete who already connected Apple Salud back to the onboarding watch step.
    void readHealthState(userId)
      .catch(() => readHealthState(userId))
      .catch((error: unknown) => {
        logger.warn('health: could not read the opt-in', error);
        return SIGNED_OUT_HEALTH;
      })
      .then((next) => {
        if (active) setState(next);
      });
    return () => {
      active = false;
    };
  }, [userId]);
  return [state, setState] as const;
}

/** «Sincronizar»: reads Apple Salud now, then refreshes the last read, the sources and the screens. */
function useHealthSyncNow(userId: string | null, setState: SetHealthState) {
  const repo = useRepository();
  const invalidate = useInvalidateRoots();
  const [busy, setBusy] = useState(false);
  const syncNow = useCallback(
    async (opts?: HealthSyncOptions): Promise<HealthSyncResult> => {
      if (!userId) throw new Error(SIGNED_OUT_MESSAGE);
      setBusy(true);
      try {
        const result = await syncHealth(repo, opts);
        const [lastSync, sources] = await Promise.all([getHealthLastSync(userId), getHealthSources(userId)]);
        setState((prev) => ({ ...prev, lastSync, sources }));
        await invalidate(HEALTH_QUERY_ROOTS);
        return result;
      } catch (error) {
        logger.warn('health: manual sync failed', error);
        throw new Error('No se pudo sincronizar con Apple Salud. Inténtalo de nuevo.');
      } finally {
        setBusy(false);
      }
    },
    [repo, userId, invalidate, setState],
  );
  return { busy, syncNow };
}

export function useHealthIntegration(): HealthIntegration {
  const userId = useUserId();
  const [available] = useState(() => isHealthAvailable());
  const [state, setState] = useHealthDeviceState(userId);
  const { busy, syncNow } = useHealthSyncNow(userId, setState);

  const connect = useCallback(
    async (opts?: HealthSyncOptions): Promise<HealthSyncResult | null> => {
      if (!available) throw new Error('Apple Salud no está disponible en este dispositivo.');
      if (!userId) throw new Error(SIGNED_OUT_MESSAGE);
      const ok = await requestHealthPermissions();
      if (!ok) throw new Error('No se pudo pedir acceso a Apple Salud. Revisa Ajustes > Salud > Road to Ironman.');
      await setHealthEnabled(userId, true);
      setState((prev) => ({ ...prev, loaded: true, enabled: true }));
      // Connected even if the first import fails (offline…): AppEffects retries on the next foreground.
      return syncNow({ days: opts?.days ?? FIRST_HEALTH_IMPORT_DAYS }).catch((error: unknown) => {
        logger.warn('health: first sync failed', error);
        return null;
      });
    },
    [available, userId, syncNow, setState],
  );

  const disable = useCallback(async () => {
    if (userId) await setHealthEnabled(userId, false);
    setState((prev) => ({ ...prev, enabled: false }));
  }, [userId, setState]);

  return { available, ...state, busy, connect, syncNow, disable };
}

export interface CalendarIntegration {
  permission: PermissionState;
  calendars: DeviceCalendar[];
  selectedIds: string[];
  lastSync: string | null;
  busy: boolean;
  request(): Promise<void>;
  setSelected(ids: string[]): Promise<void>;
  syncNow(): Promise<void>;
}

export function useCalendarIntegration(): CalendarIntegration {
  const repo = useRepository();
  const userId = useUserId();
  const invalidate = useInvalidateRoots();
  const [permission, setPermission] = useState<PermissionState>('undetermined');
  const [calendars, setCalendars] = useState<DeviceCalendar[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [perm, ids, last] = await Promise.all([
      getCalendarPermission(),
      userId ? getSelectedCalendarIds(userId) : Promise.resolve([]),
      userId ? getCalendarLastSync(userId) : Promise.resolve(null),
    ]);
    setPermission(perm);
    setSelectedIds(ids);
    setLastSync(last);
    setCalendars(perm === 'granted' ? await listDeviceCalendars().catch(() => []) : []);
  }, [userId]);

  useEffect(() => {
    void refresh().catch((error: unknown) => logger.warn('calendar: refresh failed', error));
  }, [refresh]);

  const syncNow = useCallback(async () => {
    if (!userId) throw new Error(SIGNED_OUT_MESSAGE);
    setBusy(true);
    try {
      await syncCalendarBusy(repo);
      setLastSync(await getCalendarLastSync(userId));
      await invalidate(CALENDAR_QUERY_ROOTS);
    } catch (error) {
      logger.warn('calendar: manual sync failed', error);
      throw new Error('No se pudo leer tu calendario. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  }, [repo, userId, invalidate]);

  const request = useCallback(async () => {
    await requestCalendarPermission();
    await refresh();
  }, [refresh]);

  const setSelected = useCallback(
    async (ids: string[]) => {
      if (!userId) throw new Error(SIGNED_OUT_MESSAGE);
      await setSelectedCalendarIds(userId, ids);
      setSelectedIds([...new Set(ids)]);
      await syncNow();
    },
    [userId, syncNow],
  );

  return { permission, calendars, selectedIds, lastSync, busy, request, setSelected, syncNow };
}

export interface NotificationPermissionState {
  status: PermissionState;
  request(): Promise<boolean>;
}

export function useNotificationPermission(): NotificationPermissionState {
  const repo = useRepository();
  const [status, setStatus] = useState<PermissionState>('undetermined');

  useEffect(() => {
    const check = () => void getNotificationPermission().then(setStatus);
    check();
    // The user may change it in iOS Settings while the app is in background.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => sub.remove();
  }, []);

  const request = useCallback(async () => {
    const granted = await requestNotificationPermission();
    setStatus(await getNotificationPermission());
    if (granted) void registerForPush(repo);
    return granted;
  }, [repo]);

  return { status, request };
}
