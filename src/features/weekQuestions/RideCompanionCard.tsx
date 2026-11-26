import { formatDayLabel, formatDuration } from '@/domain/dates';
import type { ISODate, Workout } from '@/domain/types';
import { openJointNew } from '@/features/together/navigation';
import { Chip } from '@/ui';

import type { FriendOption } from './friendOptions';
import { AnswerChips, QuestionCard } from './QuestionCard';
import { markRideAsked } from './rideAskStore';

/**
 * «¿Sales con alguien?» for the next outdoor ride (`nextRideToAsk`): a friend prefills a
 * quedada with that workout (nothing is sent until the athlete confirms), «Solo» closes it.
 * Each workout is asked once on this device.
 */
export function RideCompanionCard({ ride, today, friends }: { ride: Workout; today: ISODate; friends: readonly FriendOption[] }) {
  const done = () => void markRideAsked(ride.id);
  const withFriend = (friend: FriendOption) => {
    openJointNew({
      friendId: friend.id,
      fromWorkoutId: ride.id,
      date: ride.date,
      sport: ride.sport,
      durationMin: ride.durationMin,
      title: ride.title,
      intensity: ride.intensity,
      ...(ride.startTime ? { startTime: ride.startTime } : {}),
    });
    done();
  };
  return (
    <QuestionCard
      testID="ride-companion"
      icon="bike"
      title="¿Sales con alguien?"
      detail={`${ride.title} · ${formatDayLabel(ride.date, today)} · ${formatDuration(ride.durationMin)}`}
      onDismiss={done}
      dismissLabel="Cerrar">
      <AnswerChips>
        {friends.map((f) => (
          <Chip key={f.id} label={f.name} icon="profile" onPress={() => withFriend(f)} />
        ))}
        <Chip label="Solo" onPress={done} />
      </AnswerChips>
    </QuestionCard>
  );
}
