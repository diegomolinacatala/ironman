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
import { useCallback, useEffect, useState } from 'react';
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
import {
  getHealthLastSync,
  isHealthAvailable,
  isHealthEnabled,
  requestHealthPermissions,
  setHealthEnabled,
  syncHealth,
} from './healthkit';
import { getNotificationPermission, registerForPush, requestNotificationPermission } from './notifications';

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

export interface HealthIntegration {
  available: boolean;
  enabled: boolean;
  lastSync: string | null;
  busy: boolean;
  connect(): Promise<void>;
  syncNow(): Promise<void>;
  disable(): Promise<void>;
}

export function useHealthIntegration(): HealthIntegration {
  const repo = useRepository();
  const userId = useUserId();
  const invalidate = useInvalidateRoots();
  const [available] = useState(() => isHealthAvailable());
  const [enabled, setEnabled] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const load: Promise<[boolean, string | null]> = userId
      ? Promise.all([isHealthEnabled(userId), getHealthLastSync(userId)])
      : Promise.resolve([false, null]);
    void load.then(([on, last]) => {
      if (!active) return;
      setEnabled(on);
      setLastSync(last);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const syncNow = useCallback(async () => {
    if (!userId) throw new Error(SIGNED_OUT_MESSAGE);
    setBusy(true);
    try {
      await syncHealth(repo);
      setLastSync(await getHealthLastSync(userId));
      await invalidate(HEALTH_QUERY_ROOTS);
    } catch (error) {
      logger.warn('health: manual sync failed', error);
      throw new Error('No se pudo sincronizar con Apple Salud. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  }, [repo, userId, invalidate]);

  const connect = useCallback(async () => {
    if (!available) throw new Error('Apple Salud no está disponible en este dispositivo.');
    if (!userId) throw new Error(SIGNED_OUT_MESSAGE);
    const ok = await requestHealthPermissions();
    if (!ok) throw new Error('No se pudo pedir acceso a Apple Salud. Revisa Ajustes > Salud > Road to Ironman.');
    await setHealthEnabled(userId, true);
    setEnabled(true);
    // Connected even if the first import fails (offline…): AppEffects retries on the next foreground.
    await syncNow().catch((error: unknown) => logger.warn('health: first sync failed', error));
  }, [available, userId, syncNow]);

  const disable = useCallback(async () => {
    if (userId) await setHealthEnabled(userId, false);
    setEnabled(false);
  }, [userId]);

  return { available, enabled, lastSync, busy, connect, syncNow, disable };
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
