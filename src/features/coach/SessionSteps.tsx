import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { StepLine } from '@/domain/prescription';
import { Icon, Text, fonts, haptics, intensityColor, radius, space, useTheme } from '@/ui';

function stepsCount(n: number): string {
  return n === 1 ? '1 paso' : `${n} pasos`;
}

/** "Series · Z4: 3×8'. 162–168 ppm, 4:27–4:44 /km, RPE 7–8. Duro y sostenido…" */
export function stepLineLabel(line: StepLine): string {
  const head = [line.label, line.zone].filter(Boolean).join(' · ');
  return [line.amount ? `${head}: ${line.amount}` : head, line.targets.join(', '), line.cue, line.note].filter(Boolean).join('. ');
}

function StepRow({ line, divider }: { line: StepLine; divider: boolean }) {
  const { colors } = useTheme();
  const head = [line.label, line.zone].filter(Boolean).join(' · ');
  return (
    <View style={styles.step} accessible accessibilityLabel={stepLineLabel(line)}>
      <Text variant="caption" style={styles.amount}>
        {line.amount}
      </Text>
      <View style={styles.flex}>
        <View style={styles.headRow}>
          {line.zone ? <View style={[styles.dot, { backgroundColor: intensityColor[line.intensity] }]} /> : null}
          <Text variant="caption" style={styles.semibold}>
            {head}
          </Text>
        </View>
        {line.targets.length > 0 ? <Text variant="caption">{line.targets.join(' · ')}</Text> : null}
        {line.cue ? (
          <Text variant="caption" color="textMuted">
            {line.cue}
          </Text>
        ) : null}
        {line.note ? (
          <Text variant="caption" color="textMuted">
            {line.note}
          </Text>
        ) : null}
      </View>
      {divider ? <View style={[styles.rule, { backgroundColor: colors.border }]} /> : null}
    </View>
  );
}

export interface SessionStepsProps {
  lines: readonly StepLine[];
  /** Starts expanded (e.g. a single proposed session). */
  initiallyOpen?: boolean;
}

/** "Ver estructura · 4 pasos": one line per step with zone, targets and sensations. */
export function SessionSteps({ lines, initiallyOpen = false }: SessionStepsProps) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(initiallyOpen);
  if (lines.length === 0) return null;
  const count = stepsCount(lines.length);
  return (
    <View style={styles.root}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? 'Ocultar la estructura' : `Ver la estructura, ${count}`}
        accessibilityHint={open ? undefined : 'Muestra cada paso con su zona y sus ritmos'}
        hitSlop={{ top: 6, bottom: 6 }}
        onPress={() => {
          haptics.tap();
          setOpen((value) => !value);
        }}
        style={({ pressed }) => [styles.toggle, pressed && { opacity: 0.7 }]}>
        <Text variant="callout" color="accentInk" style={styles.semibold}>
          {open ? 'Ocultar estructura' : `Ver estructura · ${count}`}
        </Text>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} color={colors.accentInk} />
      </Pressable>
      {open ? (
        <View style={[styles.list, { backgroundColor: colors.surfaceAlt }]}>
          {lines.map((line, i) => (
            <StepRow key={`${i}-${line.kind}`} line={line} divider={i < lines.length - 1} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.xs },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 32, alignSelf: 'flex-start' },
  list: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.xs },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, paddingVertical: space.sm },
  amount: { width: 52, fontFamily: fonts.bodySemibold, fontVariant: ['tabular-nums'] },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  semibold: { fontFamily: fonts.bodySemibold },
  flex: { flex: 1, gap: 2 },
  rule: { position: 'absolute', left: 0, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },
});
