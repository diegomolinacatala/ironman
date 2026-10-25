import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, Icon, Tag, Text, radius, space, useTheme, type IconName } from '@/ui';

import type { StatusTone } from './garminModel';
import { StatusPill } from './StatusPill';

export interface IntegrationCardProps {
  icon: IconName;
  title: string;
  /** e.g. "Beta · oficial". */
  badge?: string;
  status: { tone: StatusTone; label: string };
  children: ReactNode;
}

/** Shell for each connection on settings/integrations. */
export function IntegrationCard({ icon, title, badge, status, children }: IntegrationCardProps) {
  const { colors } = useTheme();
  return (
    <Card padding="lg" variant="raised">
      <View style={styles.head}>
        <View style={[styles.icon, { backgroundColor: colors.inverseBg }]}>
          <Icon name={icon} size={20} color={colors.inverseText} />
        </View>
        <View style={styles.titles}>
          <View style={styles.titleRow}>
            <Text variant="heading" accessibilityRole="header">
              {title}
            </Text>
            {badge ? <Tag label={badge} color={colors.info} tone="outline" /> : null}
          </View>
          <StatusPill tone={status.tone} label={status.label} />
        </View>
      </View>
      <View style={styles.body}>{children}</View>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  icon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  titles: { flex: 1, gap: space.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  body: { marginTop: space.lg, gap: space.md },
});
