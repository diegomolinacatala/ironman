import { router } from 'expo-router';
import { Fragment, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, Divider, ListRow, SectionHeader, Text, space, useTheme, type IconName } from '@/ui';

/** Icon tile (32) + gap (12) + row inset (4): dividers start under the row text, iOS Settings style. */
export const ROW_DIVIDER_INSET = 48;

export interface SettingsGroupProps {
  title: string;
  /** Small explanatory line under the card. */
  footer?: string;
  children: ReactNode;
}

/** Tú: one titled, grouped list card (rows with icon tiles, inset dividers, chevrons). */
export function SettingsGroup({ title, footer, children }: SettingsGroupProps) {
  return (
    <View style={styles.group}>
      <SectionHeader title={title} />
      <Card padding={0} style={styles.card}>
        {children}
      </Card>
      {footer ? (
        <Text variant="caption" color="textMuted" style={styles.footer}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

export function GroupDivider() {
  return <Divider inset={ROW_DIVIDER_INSET} />;
}

export interface LinkItem {
  icon: IconName;
  title: string;
  subtitle?: string;
  href: string;
  /** Brand items get the soft accent tile. */
  brand?: boolean;
}

/** Navigation rows separated by inset dividers. */
export function LinkRows({ items }: { items: readonly LinkItem[] }) {
  const { colors } = useTheme();
  return (
    <>
      {items.map((item, index) => (
        <Fragment key={`${item.href}-${item.title}`}>
          {index > 0 ? <GroupDivider /> : null}
          <ListRow
            icon={item.icon}
            title={item.title}
            subtitle={item.subtitle}
            iconTint={item.brand ? colors.accentSoft : undefined}
            iconColor={item.brand ? colors.onAccentSoft : undefined}
            onPress={() => router.push(item.href)}
          />
        </Fragment>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm, marginTop: space.sm },
  card: { paddingHorizontal: space.md, paddingVertical: space.xs },
  footer: { paddingHorizontal: space.xs },
});
