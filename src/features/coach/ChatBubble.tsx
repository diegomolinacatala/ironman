import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Icon, Text, radius, space, useTheme } from '@/ui';

import type { ChatHint, ChatMessage } from './chatModel';
import { ProposalCard } from './ProposalCard';

export function CoachAvatar({ size = 32 }: { size?: number }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[styles.avatar, { width: size, height: size, borderRadius: size * 0.32, backgroundColor: colors.inverseBg }]}>
      <Icon name="coach" size={size * 0.55} color={colors.inverseText} />
    </View>
  );
}

/** Left-aligned coach bubble with avatar; children go below the text. */
export function CoachBubbleFrame({ children, label }: { children: ReactNode; label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.coachRow} accessible={Boolean(label)} accessibilityLabel={label}>
      <CoachAvatar />
      <View style={[styles.coachBubble, { backgroundColor: colors.surface, borderColor: colors.border }]}>{children}</View>
    </View>
  );
}

const HINT_COPY: Record<ChatHint, { text: string; label: string; href: string }> = {
  checkin: {
    text: 'El motor de reglas sabe cómo estás por tu check-in: apúntalo y vuelve a pedírmelo.',
    label: 'Hacer el check-in',
    href: '/checkin',
  },
  log_event: {
    text: 'Apunta qué te quita tiempo (trabajo, exámenes, viaje) y reorganizo la semana alrededor.',
    label: 'Apuntar imprevisto',
    href: '/event/edit?kind=work',
  },
};

function HintAction({ hint }: { hint: ChatHint }) {
  const copy = HINT_COPY[hint];
  return (
    <View style={styles.hint}>
      <Text variant="caption" color="textMuted">
        {copy.text}
      </Text>
      <Button label={copy.label} size="sm" variant="secondary" onPress={() => router.push(copy.href)} />
    </View>
  );
}

export function ChatBubble({ message }: { message: ChatMessage }) {
  const { colors } = useTheme();
  if (message.role === 'user') {
    return (
      <View style={styles.userRow}>
        <View
          accessible
          accessibilityLabel={`Tú: ${message.text}`}
          style={[styles.userBubble, { backgroundColor: colors.inverseBg }]}>
          <Text variant="body" style={{ color: colors.inverseText }}>
            {message.text}
          </Text>
        </View>
      </View>
    );
  }
  return (
    <CoachBubbleFrame>
      <Text variant="body" selectable accessibilityLabel={`Coach: ${message.text}`}>
        {message.text}
      </Text>
      {message.proposal ? <ProposalCard proposal={message.proposal} /> : null}
      {message.hint ? <HintAction hint={message.hint} /> : null}
      {message.engine === 'rules' ? (
        <Text variant="caption" color="textFaint">
          Respuesta del motor de reglas
        </Text>
      ) : null}
    </CoachBubbleFrame>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  hint: { gap: space.sm, alignItems: 'flex-start' },
  coachRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, paddingRight: space.xl },
  coachBubble: {
    flex: 1,
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    borderTopLeftRadius: radius.sm / 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  userRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingLeft: space.xxxl },
  userBubble: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    borderRadius: radius.lg,
    borderBottomRightRadius: radius.sm / 2,
    maxWidth: '100%',
  },
});
