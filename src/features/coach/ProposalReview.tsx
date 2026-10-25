import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import type { PlanProposal } from '@/domain/types';
import { Button, EmptyState, ErrorNotice, Icon, Loading, Screen, SectionHeader, Text, radius, space, useTheme } from '@/ui';

import { ChangeRow } from './ChangeRow';
import { changeCountLabel, proposalStatusLabel } from './labels';
import { PreviewTotals } from './PreviewTotals';
import { ProposalHeader } from './ProposalHeader';
import { useProposalReview, type ApplyOutcome } from './useProposalReview';

export function closeModal(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/today');
}

function OutcomeBanner({ outcome }: { outcome: ApplyOutcome }) {
  const { colors } = useTheme();
  const ok = outcome.failed.length === 0;
  return (
    <View
      accessibilityRole="alert"
      style={[styles.banner, { backgroundColor: colors.surfaceAlt, borderColor: ok ? colors.text : colors.warning }]}>
      <Icon name={ok ? 'checkCircle' : 'warning'} size={20} color={ok ? colors.text : colors.warning} />
      <View style={styles.flex}>
        <Text variant="bodyStrong">
          {outcome.applied === 1 ? '1 cambio aplicado' : `${outcome.applied} cambios aplicados`}
        </Text>
        <Text variant="caption" color="textMuted">
          {ok ? 'Tu semana ya está actualizada.' : `${changeCountLabel(outcome.failed.length)} no se han podido aplicar.`}
        </Text>
      </View>
    </View>
  );
}

function ReadOnlyBanner({ proposal }: { proposal: PlanProposal }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.banner, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
      <Icon name={proposal.status === 'discarded' ? 'close' : 'checkCircle'} size={18} color={colors.textMuted} />
      <Text variant="callout" color="textMuted" style={styles.flex}>
        {`${proposalStatusLabel(proposal.status)}. Solo lectura: los cambios ya no se pueden aplicar desde aquí.`}
      </Text>
    </View>
  );
}

/** Diff review of a plan proposal with per-change selection. */
export function ProposalReview({ proposal }: { proposal: PlanProposal }) {
  const review = useProposalReview(proposal);
  const readOnly = proposal.status !== 'pending' || review.outcome !== null;
  const failures = new Map((review.outcome?.failed ?? []).map((f) => [f.index, f.error]));
  const expected = new Map((review.preview?.failed ?? []).map((f) => [f.index, f.error]));
  const allOn = review.selectedCount === proposal.changes.length;

  const onDiscard = async () => {
    if (await review.discard()) closeModal();
  };

  // Apply/discard errors sit next to the buttons: the top of a long diff may be scrolled away.
  const footer = readOnly ? (
    <Button label="Cerrar" variant="inverse" fullWidth onPress={closeModal} />
  ) : (
    <View style={styles.footer} testID="proposal-footer">
      {review.actionError ? <ErrorNotice message={review.actionError} /> : null}
      <Button
        label={review.selectedCount === 0 ? 'Elige algún cambio' : `Aplicar ${changeCountLabel(review.selectedCount)}`}
        icon="check"
        size="lg"
        fullWidth
        loading={review.isApplying}
        disabled={review.selectedCount === 0 || review.isDiscarding}
        onPress={() => void review.apply()}
      />
      <Button
        label="Descartar"
        variant="ghost"
        size="sm"
        loading={review.isDiscarding}
        disabled={review.isApplying}
        onPress={() => void onDiscard()}
      />
    </View>
  );

  return (
    <Screen inSheet footer={footer} contentStyle={styles.content}>
      <ProposalHeader proposal={proposal} />
      {review.outcome ? <OutcomeBanner outcome={review.outcome} /> : null}
      {!review.outcome && proposal.status !== 'pending' ? <ReadOnlyBanner proposal={proposal} /> : null}
      {readOnly && review.actionError ? <ErrorNotice message={review.actionError} /> : null}
      {review.weekError ? <ErrorNotice message={review.weekError} onRetry={review.reloadWeek} /> : null}
      {!readOnly && review.preview ? (
        <PreviewTotals preview={review.preview} selectedCount={review.selectedCount} />
      ) : null}
      <View>
        <SectionHeader
          title="Cambios"
          action={readOnly ? undefined : { label: allOn ? 'Quitar todos' : 'Marcar todos', onPress: () => review.setAll(!allOn) }}
        />
        {review.isLoadingWeek ? <Loading label="Cargando tu semana…" /> : null}
        {proposal.changes.length === 0 ? (
          <EmptyState icon="checkCircle" title="Sin cambios" message="Tu semana ya encaja: el coach no propone cambios." />
        ) : null}
        {review.rows.map((row) => (
          <ChangeRow
            key={row.index}
            row={row}
            checked={readOnly ? undefined : review.selected[row.index]}
            onToggle={readOnly ? undefined : () => review.toggle(row.index)}
            error={failures.get(row.index) ?? (readOnly || !review.selected[row.index] ? null : expected.get(row.index))}
            skipped={review.outcome !== null && !review.selected[row.index]}
          />
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Room for the two-button footer pinned at the bottom.
  content: { gap: space.xl, paddingBottom: 200 },
  flex: { flex: 1 },
  footer: { gap: space.xs, alignItems: 'stretch' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
});
