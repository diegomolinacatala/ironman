import { StyleSheet, View } from 'react-native';

import type { JointParticipant } from '@/domain/types';
import { Avatar, Text, space } from '@/ui';

import { participantStatusCopy } from './jointModel';
import { StatusTag } from './StatusTag';

export interface ParticipantRowProps {
  participant: JointParticipant;
  isOrganizer: boolean;
  isMe: boolean;
}

export function ParticipantRow({ participant, isOrganizer, isMe }: ParticipantRowProps) {
  const role = [isMe ? 'Tú' : null, isOrganizer ? 'Organiza' : null].filter(Boolean).join(' · ');
  const copy = participantStatusCopy(participant.status);
  return (
    <View style={styles.row} accessible accessibilityLabel={`${participant.displayName}${role ? `, ${role}` : ''}: ${copy.label}`}>
      <Avatar name={participant.displayName} size={40} />
      <View style={styles.text}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {participant.displayName}
        </Text>
        {role ? (
          <Text variant="caption" color="textMuted">
            {role}
          </Text>
        ) : null}
      </View>
      <StatusTag copy={copy} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  text: { flex: 1, gap: 2 },
});
