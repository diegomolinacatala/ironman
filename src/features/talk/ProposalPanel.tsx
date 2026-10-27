import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useWorkouts } from '@/data/queries';
import { addDays } from '@/domain/dates';
import type { PlanProposal } from '@/domain/types';
import { ChangeRow } from '@/features/coach/ChangeRow';
import { changeCountLabel } from '@/features/coach/labels';
import { buildDiffRows } from '@/features/coach/proposalDiff';
import { Button, ErrorNotice, Text, space } from '@/ui';

import type { ProposalDecision } from './useProposalDecision';

/** Rows shown inline; the rest is one tap away in the full review. */
export const MAX_INLINE_CHANGES = 4;

export interface ProposalPanelProps {
  proposal: PlanProposal;
  decision: ProposalDecision;
}

/** Compact diff of the coach's proposal with the one primary action of this state. */
export function ProposalPanel({ proposal, decision }: ProposalPanelProps) {
  // Plan proposals may cover two weeks.
  const range = useMemo(() => ({ from: proposal.weekStart, to: addDays(proposal.weekStart, 13) }), [proposal.weekStart]);
  const workouts = useWorkouts(range);
  const rows = useMemo(() => buildDiffRows(proposal.changes, workouts.data ?? []), [proposal.changes, workouts.data]);
  const hidden = rows.length - MAX_INLINE_CHANGES;
  const busy = decision.isApplying || decision.isDiscarding;

  return (
    <View style={styles.root}>
      <View style={styles.head}>
        <Text variant="overline" color="textMuted" accessibilityRole="header">
          {`Cambios en tu plan · ${changeCountLabel(proposal.changes.length)}`}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityHint="Abre la propuesta para elegir qué cambios aplicar"
          hitSlop={12}
          onPress={() => router.push(`/proposal/${encodeURIComponent(proposal.id)}`)}>
          <Text variant="caption" color="accentInk">
            Elegir cambios
          </Text>
        </Pressable>
      </View>
      <View>
        {rows.slice(0, MAX_INLINE_CHANGES).map((row) => (
          <ChangeRow key={row.index} row={row} />
        ))}
        {hidden > 0 ? (
          <Text variant="caption" color="textMuted" style={styles.more}>
            {hidden === 1 ? 'y 1 cambio más' : `y ${hidden} cambios más`}
          </Text>
        ) : null}
      </View>
      {decision.error ? <ErrorNotice message={decision.error} /> : null}
      <View style={styles.actions}>
        <Button
          label="Aplicar cambios"
          icon="check"
          size="lg"
          fullWidth
          loading={decision.isApplying}
          disabled={busy}
          accessibilityHint={`Aplica ${changeCountLabel(proposal.changes.length)} a tu plan`}
          onPress={() => void decision.apply(proposal)}
        />
        <Button
          label="Ahora no"
          variant="ghost"
          loading={decision.isDiscarding}
          disabled={busy}
          accessibilityHint="Descarta la propuesta y deja tu plan como está"
          onPress={() => void decision.discard(proposal)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, flexWrap: 'wrap' },
  more: { paddingTop: space.sm, paddingLeft: space.sm },
  actions: { gap: space.xs, marginTop: space.sm },
});
