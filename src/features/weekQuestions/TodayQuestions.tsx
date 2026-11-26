import { useState } from 'react';

import { addDays } from '@/domain/dates';
import { nextRideToAsk, RIDE_ASK_DAYS } from '@/domain/rideCompanion';
import type { ISODate, Profile, WeekAnswers } from '@/domain/types';
import { dueQuestion, weekendOf, withAnswers } from '@/domain/weekQuestions';
import { useFriends, useProfile, useUpdateProfile, useWorkouts } from '@/data/queries';
import { logger } from '@/lib/logger';

import { friendOptions } from './friendOptions';
import { RideCompanionCard } from './RideCompanionCard';
import { useRideAsked } from './rideAskStore';
import { SundayCard, SundayFollowUp } from './SundayCard';
import { usePlacesReplan } from './usePlacesReplan';
import { WednesdayCard } from './WednesdayCard';

/**
 * Hoy's one question at a time: the Sunday / Wednesday question when it is due (Tú › Mis
 * sitios, off by default), else «¿Sales con alguien?» for the next outdoor ride (everyone).
 * Answered or closed = gone.
 */
export function TodayQuestions({ today }: { today: ISODate }) {
  const profile = useProfile().data ?? null;
  const update = useUpdateProfile();
  const friends = friendOptions(useFriends().data);
  const workouts = useWorkouts({ from: today, to: addDays(today, Math.max(RIDE_ASK_DAYS, 7) - 1) });
  const asked = useRideAsked();
  const placesReplan = usePlacesReplan(today);
  const [followUp, setFollowUp] = useState<ISODate | null>(null);

  if (!profile) return null;
  if (followUp) return <SundayFollowUp weekStart={followUp} onClose={() => setFollowUp(null)} />;

  const saveFor =
    (weekStart: ISODate) =>
    async (patch: Partial<Omit<WeekAnswers, 'weekStart'>>): Promise<Profile | null> => {
      try {
        return await update.mutateAsync({ weekQuestions: withAnswers(profile.weekQuestions, weekStart, patch) });
      } catch (error) {
        logger.warn('week question save failed', error);
        return null;
      }
    };

  const due = dueQuestion(profile, today);
  if (due?.kind === 'sunday') {
    return <SundayCard weekStart={due.weekStart} onSave={saveFor(due.weekStart)} onAnswered={() => setFollowUp(due.weekStart)} />;
  }
  if (due?.kind === 'wednesday') {
    return (
      <WednesdayCard
        profile={profile}
        weekStart={due.weekStart}
        workouts={workouts.data ?? []}
        friends={friends}
        onSave={saveFor(due.weekStart)}
        onAway={(saved) => void placesReplan.run(saved, weekendOf(due.weekStart).filter((d) => d >= today))}
      />
    );
  }
  if (asked === null || friends.length === 0) return null;
  const ride = nextRideToAsk({ workouts: workouts.data ?? [], today, asked });
  return ride ? <RideCompanionCard ride={ride} today={today} friends={friends} /> : null;
}
