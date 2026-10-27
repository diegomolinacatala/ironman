import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import type { PlanProposal } from '@/domain/types';
import { Button, Icon, Text, radius, space, useTheme, type IconName } from '@/ui';

import { FadeIn } from './motion';
import { NoteChips } from './NoteChips';
import { ProposalPanel } from './ProposalPanel';
import { resolutionNotice, type ProposalResolution, type TalkChannel, type TalkTurn } from './talkSession';
import type { ProposalDecision } from './useProposalDecision';

export function UserBubble({ text, channel }: { text: string; channel: TalkChannel }) {
  const { colors } = useTheme();
  return (
    <View style={styles.userRow}>
      <View accessible accessibilityLabel={`Tú: ${text}`} style={[styles.userBubble, { backgroundColor: colors.inverseBg }]}>
        <Icon name={channel === 'voice' ? 'mic' : 'keyboard'} size={12} color={colors.inverseText} style={styles.channel} />
        <Text variant="body" style={[styles.flexShrink, { color: colors.inverseText }]}>
          {text}
        </Text>
      </View>
    </View>
  );
}

function StatusLine({ icon, text, action }: { icon: IconName; text: string; action?: { label: string; onPress: () => void } }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.status, { borderColor: colors.border }]}>
      <Icon name={icon} size={16} color={colors.textMuted} />
      <Text variant="callout" color="textMuted" style={styles.flex}>
        {text}
      </Text>
      {action ? (
        <Pressable accessibilityRole="button" hitSlop={12} onPress={action.onPress}>
          <Text variant="caption" color="accentInk">
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ProposalStatus({ proposal, resolution }: { proposal: PlanProposal; resolution: ProposalResolution | null }) {
  if (resolution) {
    const icon: IconName = resolution.kind === 'discarded' ? 'close' : 'checkCircle';
    return <StatusLine icon={icon} text={resolutionNotice(resolution)} />;
  }
  if (proposal.changes.length === 0) return null;
  if (proposal.status !== 'pending') return <StatusLine icon="checkCircle" text="Propuesta ya revisada." />;
  return (
    <StatusLine
      icon="week"
      text="Propuesta sin aplicar."
      action={{ label: 'Revisar', onPress: () => router.push(`/proposal/${encodeURIComponent(proposal.id)}`) }}
    />
  );
}

export interface TurnViewProps {
  turn: TalkTurn;
  /** The latest answer is the hero of the screen. */
  latest: boolean;
  /** Its proposal is waiting for "Aplicar cambios" / "Ahora no". */
  open: boolean;
  decision: ProposalDecision;
  speaking: boolean;
  onListen: () => void;
  onStopSpeaking: () => void;
}

/** One exchange: what you said and what your coach answered (with its plan changes). */
export function TurnView({ turn, latest, open, decision, speaking, onListen, onStopSpeaking }: TurnViewProps) {
  const { response } = turn;
  const proposal = response.proposal;
  return (
    <View style={styles.turn}>
      <UserBubble text={turn.text} channel={turn.channel} />
      <FadeIn style={styles.reply}>
        <Text variant="overline" color="textMuted">
          Tu coach
        </Text>
        <Text variant="body" style={latest ? styles.hero : undefined} selectable accessibilityLabel={`Tu coach: ${response.reply}`}>
          {response.reply}
        </Text>
        <View style={styles.row}>
          <Button
            label={speaking ? 'Parar' : 'Escuchar'}
            icon={speaking ? 'stop' : 'speaker'}
            variant="secondary"
            size="sm"
            accessibilityHint={speaking ? 'Deja de leer la respuesta' : 'Lee la respuesta en voz alta'}
            onPress={speaking ? onStopSpeaking : onListen}
          />
          {response.engine === 'rules' ? (
            <Text variant="caption" color="textFaint" style={styles.flex}>
              Respuesta automática (sin IA)
            </Text>
          ) : null}
        </View>
        <NoteChips memory={response.memory ?? []} lifeEvent={response.lifeEvent ?? null} />
        {proposal && open ? <ProposalPanel proposal={proposal} decision={decision} /> : null}
        {proposal && !open ? <ProposalStatus proposal={proposal} resolution={turn.resolution} /> : null}
      </FadeIn>
    </View>
  );
}

const styles = StyleSheet.create({
  turn: { gap: space.md },
  userRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingLeft: space.xxxl },
  userBubble: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    borderRadius: radius.lg,
    borderBottomRightRadius: radius.sm / 2,
    maxWidth: '100%',
  },
  channel: { marginTop: 5, opacity: 0.7 },
  flexShrink: { flexShrink: 1 },
  reply: { gap: space.md },
  hero: { fontSize: 20, lineHeight: 28 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  flex: { flex: 1 },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
