import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useProposal } from '@/data/queries';
import { formatWeekRange } from '@/domain/dates';
import { Button, Icon, Tag, Text, radius, space, useTheme } from '@/ui';

import type { ProposalRef } from './chatModel';
import { changeCountLabel, proposalSourceLabel, proposalStatusLabel } from './labels';

/** Compact proposal summary inside a coach reply; opens the diff review. */
export function ProposalCard({ proposal }: { proposal: ProposalRef }) {
  const { colors } = useTheme();
  const live = useProposal(proposal.id);
  const status = live.data?.status ?? 'pending';
  const count = live.data?.changes.length ?? proposal.changeCount;
  const isPending = status === 'pending';
  const open = () => router.push(`/proposal/${proposal.id}`);

  return (
    <View
      style={[styles.card, { backgroundColor: colors.bgElevated, borderColor: isPending ? colors.text : colors.border }]}>
      <View style={styles.topRow}>
        <View style={[styles.countBox, { backgroundColor: isPending ? colors.inverseBg : colors.surfaceAlt }]}>
          <Text variant="metricSmall" style={{ color: isPending ? colors.inverseText : colors.textMuted }}>
            {count}
          </Text>
        </View>
        <View style={styles.headText}>
          <Text variant="overline" color="textMuted">
            {`Propuesta · ${formatWeekRange(proposal.weekStart)}`}
          </Text>
          <Text variant="bodyStrong">{changeCountLabel(count)}</Text>
        </View>
        <Tag label={proposalSourceLabel(proposal.source)} color={colors.info} tone="soft" icon="sparkles" />
      </View>
      <Text variant="callout" color="textMuted" numberOfLines={4}>
        {proposal.summary}
      </Text>
      {isPending ? (
        <Button
          label="Revisar"
          icon="eye"
          size="sm"
          variant="inverse"
          onPress={open}
          accessibilityHint="Abre la lista de cambios para aplicarlos o descartarlos"
        />
      ) : (
        <View style={styles.doneRow}>
          <Icon name={status === 'discarded' ? 'close' : 'checkCircle'} size={14} color={colors.textMuted} />
          <Text variant="caption" color="textMuted" style={styles.flex}>
            {proposalStatusLabel(status)}
          </Text>
          <Button label="Ver" size="sm" variant="ghost" onPress={open} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.md, borderWidth: 1, padding: space.md, gap: space.sm },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  countBox: { minWidth: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  headText: { flex: 1, gap: 2 },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  flex: { flex: 1 },
});
