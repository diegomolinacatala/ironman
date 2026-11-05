import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { PlanProposal } from '@/domain/types';
import { Button, Icon, Text, fonts, radius, space, useTheme, type IconName } from '@/ui';

import { FadeIn } from './motion';
import { NoteChips } from './NoteChips';
import { ProposalPanel } from './ProposalPanel';
import { QuedadaSuggestionCard } from './QuedadaSuggestionCard';
import { resolutionNotice, type ProposalResolution, type TalkChannel, type TalkTurn } from './talkSession';
import type { ProposalDecision } from './useProposalDecision';

/** What you said: right-aligned soft brand bubble (accentSoft + onAccentSoft). */
export function UserBubble({ text, channel }: { text: string; channel: TalkChannel }) {
  const { colors } = useTheme();
  return (
    <View style={styles.userRow}>
      <View accessible accessibilityLabel={`Tú: ${text}`} style={[styles.userBubble, { backgroundColor: colors.accentSoft }]}>
        <Icon name={channel === 'voice' ? 'mic' : 'keyboard'} size={12} color={colors.onAccentSoft} style={styles.channel} />
        <Text variant="body" color="onAccentSoft" style={styles.flexShrink}>
          {text}
        </Text>
      </View>
    </View>
  );
}

/** Left-aligned coach bubble: surface + hairline, with a small "Tu coach" byline. */
export function CoachBubble({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.coachBubble, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.byline}>
        <View style={[styles.avatar, { backgroundColor: colors.accentSoft }]}>
          <Icon name="coach" size={14} color={colors.onAccentSoft} />
        </View>
        <Text variant="caption" color="textMuted">
          Tu coach
        </Text>
      </View>
      {children}
    </View>
  );
}

function StatusLine({ icon, text, action }: { icon: IconName; text: string; action?: { label: string; onPress: () => void } }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.status, { backgroundColor: colors.surfaceAlt }]}>
      <Icon name={icon} size={16} color={colors.textMuted} />
      <Text variant="callout" color="textMuted" style={styles.flex}>
        {text}
      </Text>
      {action ? (
        <Pressable accessibilityRole="button" hitSlop={12} onPress={action.onPress} style={styles.statusAction}>
          <Text variant="callout" color="accentInk" style={styles.semibold}>
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
  /** The latest answer is the hero of the screen (and the only one that shows its quedada card). */
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
        <CoachBubble>
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
              <Text variant="caption" color="textMuted" style={styles.flex}>
                Respuesta automática (sin IA)
              </Text>
            ) : null}
          </View>
          <NoteChips memory={response.memory ?? []} lifeEvent={response.lifeEvent ?? null} />
        </CoachBubble>
        {proposal && open ? <ProposalPanel proposal={proposal} decision={decision} /> : null}
        {proposal && !open ? <ProposalStatus proposal={proposal} resolution={turn.resolution} /> : null}
        {latest && response.quedada ? <QuedadaSuggestionCard quedada={response.quedada} quiet={open} /> : null}
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
    paddingHorizontal: space.md + 2,
    paddingVertical: space.sm + 2,
    borderRadius: radius.lg,
    borderBottomRightRadius: radius.sm / 2,
    maxWidth: '100%',
  },
  channel: { marginTop: 5, opacity: 0.8 },
  flexShrink: { flexShrink: 1 },
  reply: { gap: space.md },
  coachBubble: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderTopLeftRadius: radius.sm / 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  byline: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  avatar: { width: 24, height: 24, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  hero: { fontSize: 19, lineHeight: 27 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  flex: { flex: 1 },
  semibold: { fontFamily: fonts.bodySemibold },
  statusAction: { minHeight: 32, justifyContent: 'center' },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
  },
});
