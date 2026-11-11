import { StyleSheet, View } from 'react-native';

import { Button, Card, ErrorNotice, Icon, Text, fonts, space, useTheme } from '@/ui';

import { StatusLine } from './StatusLine';
import type { WeekPlansDecision } from './useWeekPlansDecision';
import type { WeekPlanRow } from './weekPlanSuggestion';
import { weekPlansHeading } from './weekPlanSuggestion';

export interface WeekPlansCardProps {
  decision: WeekPlansDecision;
  /** A plan proposal holds the primary action: "Guardar" steps down to secondary. */
  quiet?: boolean;
}

function WeekRow({ row, divider }: { row: WeekPlanRow; divider: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={row.note ? `${row.label}. ${row.note}` : row.label}
      style={[styles.row, divider && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
      <Text variant="callout" style={styles.semibold}>
        {row.label}
      </Text>
      {row.note ? (
        <Text variant="caption" color="textMuted">
          {row.note}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The weeks your coach suggests for Plan › General ("Lun 16 nov · Descarga · 5 h"):
 * nothing changes until "Guardar en tu plan general"; the weekly plan stays as it is.
 */
export function WeekPlansCard({ decision, quiet = false }: WeekPlansCardProps) {
  const { colors } = useTheme();
  const { rows } = decision.suggestion;
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={[styles.tile, { backgroundColor: colors.accentSoft }]}>
          <Icon name="progress" size={16} color={colors.onAccentSoft} />
        </View>
        <View style={styles.flex}>
          <Text variant="caption" color="textMuted">
            Propuesta de tu coach
          </Text>
          <Text variant="heading" accessibilityRole="header">
            {weekPlansHeading(rows.length)}
          </Text>
        </View>
      </View>
      <View>
        {rows.map((row, i) => (
          <WeekRow key={row.weekStart} row={row} divider={i > 0} />
        ))}
      </View>
      {decision.error ? <ErrorNotice message={decision.error} /> : null}
      <View style={styles.actions}>
        <Button
          label="Guardar en tu plan general"
          icon="check"
          size="lg"
          fullWidth
          variant={quiet ? 'secondary' : 'primary'}
          loading={decision.isSaving}
          accessibilityHint="Guarda estas semanas en Plan, vista General, y la abre"
          onPress={() => void decision.save()}
        />
        <Button
          label="Ahora no"
          variant="ghost"
          disabled={decision.isSaving}
          accessibilityHint="Descarta la sugerencia y deja tu plan general como está"
          onPress={decision.dismiss}
        />
      </View>
    </Card>
  );
}

/** What happened to the suggestion once answered (saved → link to Plan › General). */
export function WeekPlansStatus({ decision }: { decision: WeekPlansDecision }) {
  if (decision.status === 'saved') {
    return (
      <StatusLine
        icon="checkCircle"
        text="Guardado en tu plan general."
        action={{ label: 'Ver', onPress: decision.openPlan, hint: 'Abre Plan, vista General' }}
      />
    );
  }
  if (decision.status === 'dismissed') return <StatusLine icon="close" text="Vale, dejo tu plan general como estaba." />;
  return null;
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  tile: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  row: { gap: 2, paddingVertical: space.sm },
  semibold: { fontFamily: fonts.bodySemibold },
  actions: { gap: space.xs },
});
