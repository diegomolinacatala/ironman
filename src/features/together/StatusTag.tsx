import { StyleSheet, View } from 'react-native';

import { Icon, Tag, Text, fonts, radius, useTheme } from '@/ui';

import type { StatusCopy } from './jointModel';
import { toneColor } from './palette';

export interface StatusTagProps {
  copy: StatusCopy;
  tone?: 'soft' | 'solid' | 'outline';
}

/**
 * Status label that always carries an icon (colour is never the only signal).
 * The soft tag keeps the label in `text` and tints only the icon and background, so status
 * greens/blues stay ≥ 4.5:1 at 12 pt in both schemes.
 */
export function StatusTag({ copy, tone = 'soft' }: StatusTagProps) {
  const { colors } = useTheme();
  const color = toneColor(copy.tone, colors);
  if (tone !== 'soft') return <Tag label={copy.label} color={color} icon={copy.icon} tone={tone} />;
  return (
    <View style={[styles.tag, { backgroundColor: `${color}1F` }]}>
      {copy.icon ? <Icon name={copy.icon} size={11} color={color} weight="bold" /> : null}
      <Text variant="caption" color="text" style={styles.label}>
        {copy.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
    alignSelf: 'flex-start',
  },
  label: { fontFamily: fonts.bodySemibold, fontSize: 12, lineHeight: 16 },
});
