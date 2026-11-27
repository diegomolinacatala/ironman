import { StyleSheet, View } from 'react-native';

import type { WorkoutAnalysis } from '@/domain/types';
import { Button, Card, ErrorNotice, Icon, Text, iconSize, space, useTheme, type IconName } from '@/ui';

import { a11ySentences } from '../format';
import { CoachIconTile } from './CoachingCard';
import type { WorkoutAnalysisFlow } from './useWorkoutAnalysisFlow';

function Points({ title, icon, items }: { title: string; icon: IconName; items: readonly string[] }) {
  const { colors } = useTheme();
  if (items.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text variant="overline" color="textMuted">
        {title}
      </Text>
      {items.map((item) => (
        <View key={item} style={styles.point}>
          <Icon name={icon} size={iconSize.sm} color={colors.accentInk} />
          <Text variant="callout" style={styles.flex}>
            {item}
          </Text>
        </View>
      ))}
    </View>
  );
}

function AnalysisBody({ analysis }: { analysis: WorkoutAnalysis }) {
  const source = analysis.engine === 'ai' ? 'Análisis de tu coach' : 'Análisis rápido (sin IA ahora mismo)';
  const a11y = a11ySentences([source, analysis.headline, ...analysis.wentWell, ...analysis.improve, analysis.nextStep]);
  return (
    <View accessible accessibilityLabel={a11y} style={styles.card}>
      <View style={styles.head}>
        <CoachIconTile icon="sparkles" />
        <View style={styles.flex}>
          <Text variant="caption" color="textMuted">
            {source}
          </Text>
          <Text variant="heading">{analysis.headline}</Text>
        </View>
      </View>
      <Points title="Lo que salió bien" icon="checkCircle" items={analysis.wentWell} />
      <Points title="Para la próxima" icon="target" items={analysis.improve} />
      <Points title="Y ahora" icon="arrowRight" items={[analysis.nextStep]} />
    </View>
  );
}

/** "Analizar sesión" on a completed workout: asks the coach, then shows the analysis. */
export function AnalysisCard({ flow }: { flow: WorkoutAnalysisFlow }) {
  const { analysis, analyzing, error, analyze } = flow;
  return (
    <Card padding="md" style={styles.card}>
      {analysis ? (
        <AnalysisBody analysis={analysis} />
      ) : (
        <View style={styles.head}>
          <CoachIconTile icon="sparkles" />
          <Text variant="callout" color="textMuted" style={styles.flex}>
            Tu coach compara lo que has hecho con el plan, tu check-in y la carga de la semana.
          </Text>
        </View>
      )}
      {error ? <ErrorNotice message={error} onRetry={() => analyze(analysis !== null)} /> : null}
      <Button
        label={analysis ? 'Volver a analizar' : analyzing ? 'Analizando…' : 'Analizar sesión'}
        icon={analysis ? 'refresh' : 'sparkles'}
        variant={analysis ? 'ghost' : 'primary'}
        size={analysis ? 'sm' : 'md'}
        loading={analyzing}
        fullWidth={!analysis}
        onPress={() => analyze(analysis !== null)}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1, gap: 2 },
  section: { gap: space.xs },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
});
