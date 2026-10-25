/**
 * Juntos tab, selected friend: compact week compare, Huecos comunes and
 * Oportunidades for this (or next) week.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { addDays, startOfWeek } from '@/domain/dates';
import type { Friend, ISODate } from '@/domain/types';
import { firstName } from '@/features/social/friendModel';
import { errorMessage } from '@/lib/logger';
import { ErrorNotice, Loading, SectionHeader, Segmented, space } from '@/ui';

import { CommonSlotsList } from './CommonSlotsList';
import { CompactWeekCompare } from './CompactWeekCompare';
import { defaultCompareWeek } from './compareModel';
import { prefillFromOpportunity, prefillFromSlot } from './jointForm';
import { openFriendWeek, openJointNew } from './navigation';
import { OpportunityCard } from './OpportunityCard';
import { useTogetherWeek } from './useTogetherWeek';
import { VisibilityNotice } from './VisibilityNotice';

type WeekChoice = 'this' | 'next';
const MAX_OPPORTUNITIES = 3;

export interface TogetherPanelProps {
  friend: Friend;
  myName: string;
  today: ISODate;
}

function defaultChoice(today: ISODate): WeekChoice {
  return defaultCompareWeek(today) === startOfWeek(today) ? 'this' : 'next';
}

export function TogetherPanel({ friend, myName, today }: TogetherPanelProps) {
  const [choice, setChoice] = useState<WeekChoice>(() => defaultChoice(today));
  const currentWeek = startOfWeek(today);
  const weekStart = choice === 'this' ? currentWeek : addDays(currentWeek, 7);
  const friendId = friend.profile.id;
  const name = firstName(friend.profile.displayName);
  const data = useTogetherWeek(friendId, weekStart, today);
  const opportunities = data.opportunities.slice(0, MAX_OPPORTUNITIES);

  return (
    <View style={styles.panel}>
      <Segmented<WeekChoice>
        accessibilityLabel="Semana a comparar"
        value={choice}
        onChange={setChoice}
        options={[
          { value: 'this', label: 'Esta semana' },
          { value: 'next', label: 'Próxima semana' },
        ]}
      />
      {data.isLoading ? <Loading label={`Comparando con ${name}`} /> : null}
      {data.error ? (
        <ErrorNotice
          message={errorMessage(data.error, `No se ha podido cargar la semana de ${name}.`)}
          onRetry={data.refetch}
        />
      ) : null}
      {!data.isLoading && !data.error ? (
        <>
          <CompactWeekCompare
            days={data.days}
            myName={myName}
            friendName={name}
            onPress={() => openFriendWeek(friendId, weekStart)}
          />
          <VisibilityNotice friendName={name} visibility={data.visibility} />

          <SectionHeader title="Huecos comunes" action={{ label: 'Ver semana', onPress: () => openFriendWeek(friendId, weekStart) }} />
          <CommonSlotsList
            slots={data.slots}
            today={today}
            friendName={name}
            onPropose={(slot) => openJointNew(prefillFromSlot(slot, friendId))}
            maxDays={4}
          />

          {opportunities.length > 0 ? (
            <>
              <SectionHeader
                title="Oportunidades"
                action={
                  data.opportunities.length > MAX_OPPORTUNITIES
                    ? { label: `Ver las ${data.opportunities.length}`, onPress: () => openFriendWeek(friendId, weekStart) }
                    : undefined
                }
              />
              {opportunities.map((opportunity) => (
                <OpportunityCard
                  key={opportunity.id}
                  opportunity={opportunity}
                  today={today}
                  onPropose={() => openJointNew(prefillFromOpportunity(opportunity, friendId))}
                />
              ))}
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: space.md },
});
