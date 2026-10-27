import * as Clipboard from 'expo-clipboard';
import { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { useMetrics, useWorkouts } from '@/data/queries';
import { addDays } from '@/domain/dates';
import { Button, ErrorNotice, Icon, Text, TextField, space, useTheme } from '@/ui';

import { importSummary, importSummaryLine } from '../connectModel';
import { NumberedSteps, StatusLine, SuccessHero, useInk, type GuideItem } from '../GuideParts';
import type { GarminConnect } from './useGarminConnect';

export const GARMIN_GUIDE: readonly GuideItem[] = [
  { icon: 'profile', text: 'Inicia sesión en Garmin Connect', detail: 'Se abre aquí mismo, con tu cuenta de siempre.' },
  { icon: 'key', text: 'Pulsa «Crear clave» y elige 1 año', detail: 'Así no tendrás que repetirlo en mucho tiempo.' },
  { icon: 'copy', text: 'Pulsa «Copiar» y vuelve aquí', detail: 'Cierra la ventana: la pegamos por ti.' },
];

/** Only on iOS 16+: pastes without the "Allow paste?" prompt. */
const NATIVE_PASTE = Platform.OS === 'ios' && Clipboard.isPasteButtonAvailable;
const PASTE_HEIGHT = 56;

export function GarminGuide() {
  return (
    <View style={styles.wrap}>
      <NumberedSteps items={GARMIN_GUIDE} />
      <StatusLine icon="lock" text="Es la conexión oficial de Garmin (Personal API). Solo leemos tus datos y tu clave se guarda cifrada." />
    </View>
  );
}

/** The one big paste action: the native iOS paste control, or a "Pegar clave" button. */
export function GarminPasteControl({ garmin }: { garmin: GarminConnect }) {
  const { colors } = useTheme();
  if (NATIVE_PASTE) {
    return (
      <Clipboard.ClipboardPasteButton
        accessibilityLabel="Pegar la clave de Garmin"
        acceptedContentTypes={['plain-text']}
        displayMode="iconAndLabel"
        cornerStyle="capsule"
        backgroundColor={colors.accent}
        foregroundColor={colors.onAccent}
        style={styles.nativePaste}
        onPress={(data) => {
          if (data.type === 'text') void garmin.submit(data.text);
        }}
      />
    );
  }
  return <Button label="Pegar clave" icon="clipboard" size="lg" fullWidth onPress={() => void garmin.pasteFromClipboard()} />;
}

/** Paste phase body: what to do now, errors, and a manual fallback. */
export function GarminPastePanel({ garmin, showPasteControl = false }: { garmin: GarminConnect; showPasteControl?: boolean }) {
  const { colors } = useTheme();
  const [manual, setManual] = useState(false);
  return (
    <View style={styles.wrap}>
      <View style={[styles.pasteHint, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Icon name="clipboard" size={28} color={colors.text} />
        <View style={styles.flex}>
          <Text variant="heading">¿Ya has copiado la clave?</Text>
          <Text variant="callout" color="textMuted">
            {NATIVE_PASTE ? 'Pulsa «Pegar» y la conectamos al momento.' : 'Pulsa «Pegar clave» y la conectamos al momento.'}
          </Text>
        </View>
      </View>
      {showPasteControl ? <GarminPasteControl garmin={garmin} /> : null}
      {garmin.error ? <ErrorNotice message={garmin.error} /> : null}
      {manual ? (
        <View style={styles.wrap}>
          <TextField
            label="Clave de Garmin"
            value={garmin.keyText}
            onChangeText={garmin.setKeyText}
            placeholder="Pega aquí tu clave"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            textContentType="none"
            returnKeyType="go"
            onSubmitEditing={() => void garmin.submit(garmin.keyText)}
          />
          <Button
            label="Conectar"
            icon="link"
            variant="secondary"
            fullWidth
            disabled={!garmin.keyText.trim()}
            onPress={() => void garmin.submit(garmin.keyText)}
          />
        </View>
      ) : (
        <Pressable accessibilityRole="button" onPress={() => setManual(true)} hitSlop={8} style={styles.link}>
          <Text variant="callout" color="accentInk">
            ¿No se pega? Escríbela a mano
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/** Success: what we imported (last 28 days of wellness + activities). */
export function GarminImported({ today, renewable, onRenew }: { today: string; renewable?: boolean; onRenew?: () => void }) {
  const { paper } = useInk();
  const range = useMemo(() => ({ from: addDays(today, -28), to: today }), [today]);
  const metrics = useMetrics(range);
  const workouts = useWorkouts(range);
  const loading = metrics.isLoading || workouts.isLoading;
  const line = loading ? 'Mirando qué hemos traído…' : importSummaryLine(importSummary(metrics.data ?? [], workouts.data ?? []));
  return (
    <SuccessHero title="Garmin conectado" message={line}>
      <Text variant="caption" style={[styles.attribution, { color: paper }]}>
        Datos de Garmin. Se sincroniza solo cada mañana.
      </Text>
      {renewable && onRenew ? <Button label="Usar otra clave" variant="secondary" size="sm" icon="key" onPress={onRenew} /> : null}
    </SuccessHero>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  flex: { flex: 1, gap: 2 },
  pasteHint: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: 22, borderWidth: 1 },
  nativePaste: { height: PASTE_HEIGHT, width: '100%' },
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  attribution: { opacity: 0.7 },
});
