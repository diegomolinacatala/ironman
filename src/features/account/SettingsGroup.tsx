import { router } from 'expo-router';
import { Fragment, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Disclosure, Divider, ListRow, space, useTheme, type IconName } from '@/ui';

/** Icon tile (32) + gap (12) + row inset (4): dividers start under the row text, iOS Settings style. */
export const ROW_DIVIDER_INSET = 48;

export interface SettingsGroupProps {
  title: string;
  summary: string;
  icon: IconName;
  children: ReactNode;
}

/** A category in the settings index. Its controls mount when the athlete opens it. */
export function SettingsGroup({ title, summary, icon, children }: SettingsGroupProps) {
  return (
    <Disclosure variant="plain" title={title} summary={summary} icon={icon} style={styles.category}>
      <View style={styles.controls}>{children}</View>
    </Disclosure>
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
  category: { paddingHorizontal: space.lg, paddingVertical: space.xs },
  controls: { paddingBottom: space.md },
});
