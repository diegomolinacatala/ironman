import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import type { SleepSnapshot, SleepVerdict } from '@/domain/types';
import { Card, Divider, Icon, ProgressRing, Text, space, useTheme, type IconName, type Theme } from '@/ui';

import { formatSleepHours, hrvTrend, sleepStages, sleepVerdictLabel, sleepWindow, spokenDuration } from './briefingModel';
import { TrendArrow } from './SleepFacts';
import { StagesBar } from './StagesBar';

const RING_SIZE = 92;

export function verdictColor(verdict: SleepVerdict, colors: Theme['colors']): string {
  if (verdict === 'great' || verdict === 'good') return colors.success;
  if (verdict === 'fair') return colors.warning;
  if (verdict === 'poor') return colors.danger;
  return colors.textMuted;
}

function ScoreRing({ score, verdict }: { score: number; verdict: SleepVerdict }) {
  const { colors } = useTheme();
  return (
    <View accessible accessibilityLabel={`Puntuación de sueño: ${Math.round(score)} de 100`}>
      <ProgressRing value={score / 100} size={RING_SIZE} stroke={8} color={verdictColor(verdict, colors)}>
        <Text variant="metric">{String(Math.round(score))}</Text>
        <Text variant="overline" color="textMuted">
          de 100
        </Text>
      </ProgressRing>
    </View>
  );
}

interface RecoveryRowProps {
  icon: IconName;
  title: string;
  value: string;
  detail?: string;
  /** Leading element of the detail line (trend arrow). */
  children?: ReactNode;
}

function RecoveryRow({ icon, title, value, detail, children }: RecoveryRowProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.recovery} accessible accessibilityLabel={`${title}: ${value}${detail ? `. ${detail}` : ''}`}>
      <Icon name={icon} size={18} color={colors.textMuted} />
      <View style={styles.flex}>
        <Text variant="caption" color="textMuted">
          {title}
        </Text>
        {detail ? (
          <View style={styles.detail}>
            {children}
            <Text variant="caption" color="textMuted" style={styles.flex}>
              {detail}
            </Text>
          </View>
        ) : null}
      </View>
      <Text variant="metricSmall">{value}</Text>
    </View>
  );
}

/** Last night in full: score ring, hours, stages, bedtime → wake time, HRV, resting HR, Body Battery. */
export function SleepCard({ sleep, verdict }: { sleep: SleepSnapshot; verdict: SleepVerdict }) {
  const { colors } = useTheme();
  const hours = formatSleepHours(sleep.hours);
  const window = sleepWindow(sleep);
  const stages = sleepStages(sleep);
  const hrv = hrvTrend(sleep.hrvMs, sleep.hrvBaselineMs);
  return (
    <Card padding="lg" style={styles.card}>
      <View style={styles.top}>
        {sleep.score != null ? <ScoreRing score={sleep.score} verdict={verdict} /> : null}
        <View style={styles.flex}>
          <Text variant="overline" color="textMuted">
            Anoche
          </Text>
          {hours && sleep.hours != null ? (
            <Text variant="display" accessibilityLabel={`Has dormido ${spokenDuration(sleep.hours * 60)}`}>
              {hours}
            </Text>
          ) : null}
          <Text variant="callout">{sleepVerdictLabel(verdict)}</Text>
          {window ? (
            <View style={styles.window} accessible accessibilityLabel={`Te dormiste a las ${window.start} y te despertaste a las ${window.end}`}>
              <Icon name="moon" size={13} color={colors.textMuted} />
              <Text variant="caption" color="textMuted">
                {`${window.start} → ${window.end}`}
              </Text>
              <Icon name="sunrise" size={13} color={colors.textMuted} />
            </View>
          ) : null}
        </View>
      </View>

      <StagesBar stages={stages} />

      {sleep.hrvMs != null || sleep.restingHr != null || sleep.bodyBattery != null ? <Divider /> : null}
      {sleep.hrvMs != null ? (
        <RecoveryRow icon="hrv" title="Variabilidad cardiaca (VFC)" value={`${Math.round(sleep.hrvMs)} ms`} detail={hrv?.detail}>
          {hrv ? <TrendArrow trend={hrv.direction} /> : null}
        </RecoveryRow>
      ) : null}
      {sleep.restingHr != null ? (
        <RecoveryRow icon="pulse" title="Pulso en reposo" value={`${Math.round(sleep.restingHr)} ppm`} />
      ) : null}
      {sleep.bodyBattery != null ? (
        <RecoveryRow icon="battery" title="Body Battery al despertar" value={`${Math.round(sleep.bodyBattery)}`} detail="De 0 a 100: tu energía para hoy" />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.lg },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  flex: { flex: 1 },
  window: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.xs },
  recovery: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  detail: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
});
