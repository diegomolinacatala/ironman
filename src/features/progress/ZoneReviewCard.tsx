/**
 * Quiet suggestion in Progreso when easy sessions keep coming out harder than planned
 * (`domain/review.reviewTrend`): it never changes anything by itself, it only links to
 * the thresholds (Tú › Perfil). «Ahora no» hides it for two weeks.
 */
import { StyleSheet, View } from 'react-native';

import type { ReviewTrend } from '@/domain/review';
import { Button, Card, Icon, Text, iconSize, space, useTheme } from '@/ui';

export interface ZoneReviewCardProps {
  trend: ReviewTrend;
  onReview: () => void;
  onDismiss: () => void;
}

export function ZoneReviewCard({ trend, onReview, onDismiss }: ZoneReviewCardProps) {
  const { colors } = useTheme();
  return (
    <Card variant="flat">
      <View style={styles.header}>
        <Icon name="heartOutline" size={iconSize.sm} color={colors.accentInk} />
        <Text variant="bodyStrong" style={styles.title}>
          {trend.message}
        </Text>
      </View>
      <Text variant="caption" color="textMuted" style={styles.body}>
        {`${trend.detail} ${trend.advice}`}
      </Text>
      <View style={styles.actions}>
        <Button
          label="Revisar mis umbrales"
          variant="secondary"
          size="sm"
          accessibilityHint="Abre tu perfil deportivo, donde están tus umbrales"
          onPress={onReview}
        />
        <Button label="Ahora no" variant="ghost" size="sm" accessibilityHint="Oculta esta sugerencia durante dos semanas" onPress={onDismiss} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  title: { flex: 1 },
  body: { marginTop: space.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
});
