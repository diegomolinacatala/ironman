import { router } from 'expo-router';
import { useState } from 'react';

import type { ISODate, Profile, WeekAnswers, Workout } from '@/domain/types';
import { answersFor, asksAboutRide, weekendOf } from '@/domain/weekQuestions';
import { openJointNew } from '@/features/together/navigation';
import { Button, Chip, Text } from '@/ui';

import { AnswerChips, QuestionCard } from './QuestionCard';
import { markRideAsked } from './rideAskStore';
import type { FriendOption } from './friendOptions';

type Save = (patch: Partial<Omit<WeekAnswers, 'weekStart'>>) => Promise<Profile | null>;
type Step = 'away' | 'ride' | 'who';

/** Where the Wednesday question is, from what is already stored. */
export function wednesdayStep(profile: Profile, weekStart: ISODate): Step {
  const a = answersFor(profile, weekStart);
  if (a?.awayWeekend === undefined) return 'away';
  if (a.awayWeekend && asksAboutRide(profile) && a.awayRide === undefined) return 'ride';
  return 'who';
}

/** The planned ride of the weekend (outside or on the rodillo), if any: the quedada is prefilled with it. */
export function weekendRide(workouts: readonly Workout[], weekStart: ISODate): Workout | null {
  const weekend = weekendOf(weekStart);
  return workouts.find((w) => w.status === 'planned' && w.sport === 'bike' && weekend.includes(w.date) && w.jointSessionId === null) ?? null;
}

/**
 * «Tu fin de semana» (Wednesday, also Thursday; only with a second place): «¿Vuelves a
 * Castellón?» → the weekend's sessions follow the gear there (a proposal to review) → when
 * the road bike is there and not at home, «¿Quieres salir en bici?» → «¿Con quién?», which
 * prefills a quedada (nothing is sent until the athlete confirms it).
 */
export function WednesdayCard({
  profile,
  weekStart,
  workouts,
  friends,
  onSave,
  onAway,
}: {
  profile: Profile;
  weekStart: ISODate;
  workouts: readonly Workout[];
  friends: readonly FriendOption[];
  onSave: Save;
  /** The athlete goes back: fit the weekend to the gear there (gets the saved profile). */
  onAway: (saved: Profile) => void;
}) {
  const [busy, setBusy] = useState(false);
  const away = profile.places?.away?.name ?? 'tu otra ciudad';
  const step = wednesdayStep(profile, weekStart);
  const save = async (patch: Partial<Omit<WeekAnswers, 'weekStart'>>) => {
    setBusy(true);
    const saved = await onSave(patch);
    setBusy(false);
    return saved;
  };
  const dismiss = () => void save({ wednesdayDone: true });

  if (step === 'away') {
    const yes = async () => {
      const saved = await save({ awayWeekend: true, ...(asksAboutRide(profile) ? {} : { wednesdayDone: true }) });
      if (saved) onAway(saved);
    };
    return (
      <QuestionCard testID="week-question-wednesday" icon="location" title="Tu fin de semana" detail={`¿Este fin de semana vuelves a ${away}?`} onDismiss={dismiss}>
        <AnswerChips>
          <Chip label={`Sí, a ${away}`} disabled={busy} onPress={() => void yes()} />
          <Chip label="No, me quedo" disabled={busy} onPress={() => void save({ awayWeekend: false, wednesdayDone: true })} />
        </AnswerChips>
      </QuestionCard>
    );
  }

  if (step === 'ride') {
    return (
      <QuestionCard testID="week-question-wednesday" icon="bike" title={`Finde en ${away}`} detail={`Allí tienes la bici. ¿Quieres salir en bici?`} onDismiss={dismiss}>
        <AnswerChips>
          <Chip label="Sí, salgo" disabled={busy} onPress={() => void save({ awayRide: true })} />
          <Chip label="Esta vez no" disabled={busy} onPress={() => void save({ awayRide: false, wednesdayDone: true })} />
        </AnswerChips>
      </QuestionCard>
    );
  }

  const ride = weekendRide(workouts, weekStart);
  const withFriend = (friend: FriendOption) => {
    const [saturday] = weekendOf(weekStart);
    openJointNew(
      ride
        ? { friendId: friend.id, fromWorkoutId: ride.id, date: ride.date, sport: 'bike', durationMin: ride.durationMin, title: ride.title, intensity: ride.intensity, ...(ride.startTime ? { startTime: ride.startTime } : {}) }
        : { friendId: friend.id, date: saturday, sport: 'bike', durationMin: 120, title: 'Salida en bici juntos' },
    );
    if (ride) void markRideAsked(ride.id);
    void save({ wednesdayDone: true });
  };
  return (
    <QuestionCard testID="week-question-wednesday" icon="together" title="¿Con quién?" detail={`Tu salida en bici en ${away}${ride ? ` · ${ride.title}` : ''}.`} onDismiss={dismiss}>
      {friends.length === 0 ? (
        <Text variant="callout" color="textMuted">
          Aún no tienes amigos en la app.
        </Text>
      ) : null}
      <AnswerChips>
        {friends.map((f) => (
          <Chip key={f.id} label={f.name} icon="profile" disabled={busy} onPress={() => withFriend(f)} />
        ))}
        <Chip label="Solo" disabled={busy} onPress={dismiss} />
      </AnswerChips>
      {friends.length === 0 ? <Button label="Añadir amigos" size="sm" variant="ghost" onPress={() => router.push('/friends/add')} /> : null}
    </QuestionCard>
  );
}
