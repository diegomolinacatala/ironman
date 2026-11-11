import { StyleSheet, View } from 'react-native';

import { formatWeekRange } from '@/domain/dates';
import type { PlanProposal } from '@/domain/types';
import { Icon, Tag, Text, space, useTheme } from '@/ui';

import { changeCountLabel, proposalKindLabel, proposalSourceLabel, proposalStatusLabel, splitSummary } from './labels';

/** Summary block on top of the proposal review: one-sentence headline, the rest as supporting text. */
export function ProposalHeader({ proposal }: { proposal: PlanProposal }) {
  const { colors } = useTheme();
  const isPending = proposal.status === 'pending';
  const { headline, rest } = splitSummary(proposal.summary);
  return (
    <View style={styles.wrap}>
      <View style={styles.tags}>
        <Tag label={proposalSourceLabel(proposal.source)} color={colors.info} tone="soft" icon="sparkles" />
        <Tag label={proposalKindLabel(proposal.kind)} color={colors.textMuted} tone="outline" />
        {!isPending ? (
          <Tag
            label={proposalStatusLabel(proposal.status)}
            color={colors.textMuted}
            tone="soft"
            icon={proposal.status === 'discarded' ? 'close' : 'checkCircle'}
          />
        ) : null}
      </View>
      <View style={styles.weekRow}>
        <Icon name="week" size={14} color={colors.textMuted} />
        <Text variant="caption" color="textMuted">
          {`Semana ${formatWeekRange(proposal.weekStart)} · ${changeCountLabel(proposal.changes.length)}`}
        </Text>
      </View>
      {headline ? (
        <Text variant="title" accessibilityRole="header">
          {headline}
        </Text>
      ) : null}
      {rest ? (
        <Text variant="callout" color="textMuted">
          {rest}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  weekRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
});
