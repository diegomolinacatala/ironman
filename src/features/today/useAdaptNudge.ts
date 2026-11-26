import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { addDays, startOfWeek } from '@/domain/dates';
import { computeReadiness } from '@/domain/readiness';
import { replanForReadiness, replanMissed } from '@/domain/replanner';
import type { ISODate } from '@/domain/types';
import {
  useBusyBlocks,
  useCheckins,
  useCreateProposal,
  useJointSessions,
  useLifeEvents,
  useMetrics,
  useProfile,
  useProposals,
  useRaces,
  useWorkouts,
} from '@/data/queries';
import { errorMessage, logger } from '@/lib/logger';
import { readJson, writeJson } from '@/lib/storage';

import { adaptNudge, MISSED_LOOKBACK_DAYS, type AdaptNudge } from './adaptNudge';

const DISMISSED_KEY = 'rti.adapt.dismissed.v1';
const METRICS_DAYS = 30;
const EVENTS_BACK_DAYS = 14;

interface Dismissed {
  date: ISODate;
  keys: string[];
}

/**
 * Hoy's own adaptation offer (see `adaptNudge`): the nudge to show, and `run` to turn it into a
 * re-plan proposal (today eased, or the missed key session placed again) that opens for review.
 * "Ahora no" hides it for the day.
 */
export function useAdaptNudge(today: ISODate, checkinDone: boolean): {
  nudge: AdaptNudge | null;
  run: () => Promise<void>;
  dismiss: () => void;
  busy: boolean;
  message: string | null;
} {
  const range = { from: addDays(today, -MISSED_LOOKBACK_DAYS - 1), to: addDays(today, 6) };
  const workouts = useWorkouts(range);
  const metrics = useMetrics({ from: addDays(today, -METRICS_DAYS), to: today });
  const checkins = useCheckins({ from: today, to: today });
  const profile = useProfile();
  const busyBlocks = useBusyBlocks(range);
  const lifeEvents = useLifeEvents({ from: addDays(today, -EVENTS_BACK_DAYS), to: range.to });
  const joint = useJointSessions(range);
  const races = useRaces();
  const proposals = useProposals('pending');
  const create = useCreateProposal();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void readJson<Dismissed | null>(DISMISSED_KEY, null).then((stored) => {
      if (live && stored?.date === today) setDismissed(stored.keys);
    });
    return () => {
      live = false;
    };
  }, [today]);

  const loading = workouts.isLoading || metrics.isLoading || proposals.isLoading;
  const readiness = metrics.data ? computeReadiness({ today, checkin: checkins.data?.[0] ?? null, metrics: metrics.data }) : null;
  const nudge = loading
    ? null
    : adaptNudge({ today, readiness, checkinDone, workouts: workouts.data ?? [], pendingProposals: proposals.data?.length ?? 0, dismissed });

  const dismiss = () => {
    if (!nudge) return;
    const keys = [...dismissed, nudge.key];
    setDismissed(keys);
    void writeJson(DISMISSED_KEY, { date: today, keys } satisfies Dismissed);
  };

  const run = async () => {
    if (!nudge || !profile.data) return;
    setMessage(null);
    const input = {
      today,
      weekWorkouts: workouts.data ?? [],
      profile: profile.data,
      busyBlocks: busyBlocks.data ?? [],
      lifeEvents: lifeEvents.data ?? [],
      jointSessions: joint.data ?? [],
      races: races.data ?? [],
    };
    try {
      const result =
        nudge.kind === 'readiness' && readiness ? replanForReadiness({ ...input, readiness }) : replanMissed({ ...input, missed: nudge.kind === 'missed' ? nudge.workouts : [] });
      if (result.changes.length === 0) {
        setMessage(result.summary || 'No hace falta cambiar nada.');
        dismiss();
        return;
      }
      const proposal = await create.mutateAsync({ kind: 'replan', source: 'rules', weekStart: startOfWeek(today), summary: result.summary, changes: result.changes });
      router.push(`/proposal/${proposal.id}`);
    } catch (error) {
      logger.warn('adapt nudge failed', error);
      setMessage(errorMessage(error, 'No se pudo preparar el cambio. Inténtalo de nuevo.'));
    }
  };

  return { nudge, run, dismiss, busy: create.isPending, message };
}
