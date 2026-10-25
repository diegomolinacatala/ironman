import { Fragment } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, Divider, Icon, SectionHeader, Text, radius, space, useTheme } from '@/ui';

import type { PrivacySectionContent } from './privacyPolicy';

/** One block of the in-app privacy summary: a header and icon + text points. */
export function PrivacySummarySection({ section }: { section: PrivacySectionContent }) {
  const { colors } = useTheme();
  return (
    <View>
      <SectionHeader title={section.title} />
      <Card padding="md">
        {section.points.map((point, index) => (
          <Fragment key={point.title}>
            {index > 0 ? <Divider inset={46} /> : null}
            <View style={styles.row}>
              <View style={[styles.icon, { backgroundColor: colors.surfaceAlt }]}>
                <Icon name={point.icon} size={16} color={colors.text} />
              </View>
              <View style={styles.text}>
                <Text variant="bodyStrong">{point.title}</Text>
                <Text variant="caption" color="textMuted">
                  {point.text}
                </Text>
              </View>
            </View>
          </Fragment>
        ))}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: space.sm },
  icon: { width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
});
