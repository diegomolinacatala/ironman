import { StyleSheet, View } from 'react-native';

import { formatDayLabel, formatDuration } from '@/domain/dates';
import { sportLabel } from '@/domain/labels';
import type { ISODate } from '@/domain/types';
import { Button, Card, SportBadge, Tag, Text, space, useTheme } from '@/ui';

import { slotEdge } from './palette';
import type { Opportunity } from './types';

export interface OpportunityCardProps {
  opportunity: Opportunity;
  today: ISODate;
  onPropose: () => void;
}

const KIND_LABEL: Record<Opportunity['kind'], string> = {
  same_session: 'Misma sesión',
  same_sport: 'Mismo deporte',
  free_slot: 'Hueco libre',
};

/** "Los dos tenéis rodaje largo el sábado — ¿lo hacéis juntos?" + CTA. */
export function OpportunityCard({ opportunity, today, onPropose }: OpportunityCardProps) {
  const theme = useTheme();
  const meta = [
    formatDayLabel(opportunity.date, today),
    opportunity.start,
    opportunity.durationMin > 0 ? formatDuration(opportunity.durationMin) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Card padding="lg" rail={theme.sport(opportunity.sport).base} variant="flat">
      <View style={styles.top}>
        <SportBadge sport={opportunity.sport} size={44} />
        <View style={styles.text}>
          <View style={styles.tags}>
            <Tag label={KIND_LABEL[opportunity.kind] ?? 'Juntos'} color={slotEdge(theme.colors)} tone="outline" icon="together" />
            <Text variant="caption" color="textMuted">
              {sportLabel(opportunity.sport)}
            </Text>
          </View>
          <Text variant="heading">{opportunity.title}</Text>
          <Text variant="callout" color="textMuted">
            {opportunity.reason}
          </Text>
          <Text variant="caption" color="textMuted">
            {meta}
          </Text>
        </View>
      </View>
      <Button
        label="Proponer quedada"
        icon="send"
        onPress={onPropose}
        style={styles.cta}
        accessibilityHint="Abre el formulario de quedada con estos datos"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  text: { flex: 1, gap: space.xs },
  tags: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  cta: { alignSelf: 'flex-start', marginTop: space.md, marginLeft: 44 + space.md },
});
