/**
 * Fueling and transition blocks of the race plan, plus the "add your thresholds"
 * hint. Plain blocks (no bordered cards): they live inside the plan's fold.
 */
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { fuelingScheduleText, type FuelingSchedule } from '@/domain/fueling';
import type { FuelPlan } from '@/domain/racePlan';
import { Icon, Text, fonts, haptics, iconSize, radius, space, useTheme, type IconName } from '@/ui';

function BlockHeader({ icon, title }: { icon: IconName; title: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.header}>
      <View style={[styles.tile, { backgroundColor: colors.surfaceAlt }]}>
        <Icon name={icon} size={18} color={colors.textMuted} />
      </View>
      <Text variant="bodyStrong" accessibilityRole="header" style={styles.flex}>
        {title}
      </Text>
    </View>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.line} accessible>
      <Text variant="callout" style={styles.label}>
        {label}
      </Text>
      <Text variant="caption" color="textMuted">
        {children}
      </Text>
    </View>
  );
}

function rangeText(min: number, max: number): string {
  return min === max ? String(min) : `${min}–${max}`;
}

/** "70 g/h de hidratos · 500–800 ml/h · sodio 300–600 mg/h" (water only: "Agua · 400–750 ml/h"). */
export function fuelHeadline(fuel: FuelPlan): string {
  const carbs = fuel.targetCarbsPerHour > 0 ? `${fuel.targetCarbsPerHour} g/h de hidratos` : 'Agua';
  const fluid = fuel.fluidMlPerHour.max > 0 ? `${rangeText(fuel.fluidMlPerHour.min, fuel.fluidMlPerHour.max)} ml/h` : null;
  const sodium = fuel.sodiumMgPerHour ? `sodio ${rangeText(fuel.sodiumMgPerHour.min, fuel.sodiumMgPerHour.max)} mg/h` : null;
  return [carbs, fluid, sodium].filter((part): part is string => part !== null).join(' · ');
}

function scheduleText(schedule: FuelingSchedule | null): string {
  return schedule ? fuelingScheduleText(schedule) : 'Agua a sorbos; no hace falta comer.';
}

export function RaceFuelBlock({ fuel, triathlon }: { fuel: FuelPlan; triathlon: boolean }) {
  return (
    <View style={styles.block} testID="race-plan-fuel">
      <BlockHeader icon="drop" title="Nutrición" />
      <Text variant="heading" style={styles.numbers}>
        {fuelHeadline(fuel)}
      </Text>
      <Line label="Antes">{fuel.before}</Line>
      {triathlon ? <Line label="En la bici (desde la T1)">{scheduleText(fuel.bike)}</Line> : null}
      <Line label={triathlon ? 'Corriendo (desde la T2)' : 'Durante la carrera'}>{scheduleText(fuel.run)}</Line>
      {fuel.notes.map((note) => (
        <Text key={note} variant="caption" color="textMuted">
          {note}
        </Text>
      ))}
    </View>
  );
}

function Checklist({ title, items }: { title: string; items: readonly string[] }) {
  const { colors } = useTheme();
  return (
    <View style={styles.checklist}>
      <Text variant="callout" style={styles.label}>
        {title}
      </Text>
      {items.map((item) => (
        <View key={item} style={styles.check} accessible>
          <Icon name="check" size={iconSize.sm} color={colors.accentInk} />
          <Text variant="caption" style={styles.flex}>
            {item}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function RaceTransitions({ t1, t2 }: { t1: readonly string[]; t2: readonly string[] }) {
  return (
    <View style={styles.block} testID="race-plan-transitions">
      <BlockHeader icon="brick" title="Transiciones" />
      <Checklist title="T1 · natación → bici" items={t1} />
      <Checklist title="T2 · bici → carrera" items={t2} />
    </View>
  );
}

/** "Añade tu FTP… en Tú › Perfil": opens the athlete's profile (thresholds). */
export function RacePlanHint({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityHint="Abre tu perfil deportivo"
      onPress={() => {
        haptics.tap();
        router.push('/settings/profile');
      }}
      style={({ pressed }) => [styles.hint, { backgroundColor: pressed ? colors.surfacePressed : colors.surfaceAlt }]}>
      <Icon name="info" size={iconSize.sm} color={colors.accentInk} />
      <Text variant="caption" style={styles.flex}>
        {text}
      </Text>
      <Icon name="chevronRight" size={14} color={colors.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  tile: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  numbers: { fontVariant: ['tabular-nums'] },
  line: { gap: 2 },
  label: { fontFamily: fonts.bodySemibold },
  checklist: { gap: space.xs },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
  },
});
