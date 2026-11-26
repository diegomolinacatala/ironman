import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { Button, Chip, Text, haptics, space, useTheme } from '@/ui';

import { BREATH, PHASE_HINT, PHASE_LABEL, breathAt, clockText, remainingLabel, type BreathPhase } from './breathingModel';

type Status = 'idle' | 'running' | 'paused' | 'done';

const CIRCLE = 220;
const SMALL = 0.55;
const TICK_MS = 1000;

/** The breathing circle: grows while inhaling, shrinks while exhaling; still with reduced motion. */
function BreathCircle({ phase, active }: { phase: BreathPhase; active: boolean }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const scale = useSharedValue(SMALL);

  useEffect(() => {
    if (reduced || !active) {
      cancelAnimation(scale);
      return undefined;
    }
    const inhale = phase === 'inhale';
    scale.set(withTiming(inhale ? 1 : SMALL, { duration: (inhale ? BREATH.inhaleSec : BREATH.exhaleSec) * 1000, easing: Easing.inOut(Easing.quad) }));
    return () => cancelAnimation(scale);
  }, [phase, active, reduced, scale]);

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  // Reduced motion: a fixed middle size; the words and the count do the guiding.
  const still = { transform: [{ scale: 0.8 }] };
  return (
    <View style={styles.circleBox} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Animated.View
        style={[styles.circle, { backgroundColor: colors.accentSoft, borderColor: colors.accent }, reduced ? still : animated]}
        testID="breath-circle"
      />
    </View>
  );
}

/**
 * About three minutes of slow breathing (inhale 4 s, exhale 6 s). Calm by design: one primary
 * action, no sound, optional soft haptic at each change of phase.
 */
export function BreathingSession({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<Status>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [vibrate, setVibrate] = useState(false);
  const state = breathAt(elapsed);
  const lastPhase = useRef<BreathPhase | null>(null);
  const elapsedRef = useRef(0);

  useEffect(() => {
    if (status !== 'running') return undefined;
    const timer = setInterval(() => {
      const next = Math.min(BREATH.totalSec, elapsedRef.current + 1);
      elapsedRef.current = next;
      setElapsed(next);
      if (next >= BREATH.totalSec) {
        setStatus('done');
        haptics.success();
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (status !== 'running') return;
    if (vibrate && lastPhase.current !== null && lastPhase.current !== state.phase) haptics.tap();
    lastPhase.current = state.phase;
  }, [status, state.phase, vibrate]);

  const start = () => {
    elapsedRef.current = 0;
    setElapsed(0);
    lastPhase.current = null;
    setStatus('running');
  };

  if (status === 'done') {
    return (
      <View style={styles.wrap}>
        <View style={styles.text}>
          <Text variant="title">Tres minutos para ti</Text>
          <Text variant="body" color="textMuted">
            Bien hecho. Si ya es de noche, pantalla fuera y a la cama: dormir es la mejor recuperación cuando vas cargado.
          </Text>
        </View>
        <Button label="Cerrar" size="lg" fullWidth onPress={onClose} />
        <Button label="Otra vez" variant="ghost" fullWidth onPress={start} />
      </View>
    );
  }

  const running = status === 'running';
  return (
    <View style={styles.wrap}>
      <View style={styles.text}>
        <Text variant="title">Respira despacio</Text>
        <Text variant="body" color="textMuted">
          {`Inspira ${BREATH.inhaleSec} segundos y suelta el aire en ${BREATH.exhaleSec}. Tres minutos bastan para bajar revoluciones.`}
        </Text>
      </View>

      <BreathCircle phase={state.phase} active={running} />

      <View style={styles.center} accessibilityLiveRegion="polite">
        {status === 'idle' ? (
          <Text variant="heading" color="textMuted">
            Ponte cómodo y suelta los hombros
          </Text>
        ) : (
          <>
            <Text variant="title" accessibilityRole="header">
              {PHASE_LABEL[state.phase]}
            </Text>
            <Text variant="callout" color="textMuted">
              {PHASE_HINT[state.phase]}
            </Text>
            <Text variant="metricSmall" accessibilityLabel={`Quedan ${remainingLabel(state.remainingSec)}`}>
              {clockText(state.remainingSec)}
            </Text>
          </>
        )}
      </View>

      <View style={styles.actions}>
        {status === 'idle' ? <Button label="Empezar" size="lg" icon="play" fullWidth onPress={start} /> : null}
        {running ? <Button label="Pausa" size="lg" variant="secondary" icon="pause" fullWidth onPress={() => setStatus('paused')} /> : null}
        {status === 'paused' ? <Button label="Seguir" size="lg" icon="play" fullWidth onPress={() => setStatus('running')} /> : null}
        {status !== 'idle' ? <Button label="Terminar" variant="ghost" fullWidth onPress={onClose} /> : null}
        <View style={styles.chips}>
          <Chip label="Vibración suave" selected={vibrate} onPress={() => setVibrate((v) => !v)} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xl },
  text: { gap: space.sm },
  circleBox: { height: CIRCLE, alignItems: 'center', justifyContent: 'center' },
  circle: { width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2, borderWidth: 2 },
  center: { alignItems: 'center', gap: space.xs, minHeight: 96 },
  actions: { gap: space.sm },
  chips: { flexDirection: 'row', justifyContent: 'center' },
});
