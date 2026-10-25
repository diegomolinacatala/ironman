import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useConnectGarmin } from '@/data/queries';
import type { ISODate } from '@/domain/types';
import { errorMessage, logger } from '@/lib/logger';
import { Button, Chip, ErrorNotice, Text, TextField, haptics, radius, space, useTheme } from '@/ui';

import { formatDateShort } from './format';
import { GARMIN_EXPIRY_OPTIONS, GARMIN_KEY_URL, expiryDateFor, garminKeyError } from './garminModel';

const STEPS = [
  'Abre Garmin Connect → Ajustes → Personal API y pulsa “Create Key”.',
  'Elige cuánto dura la clave (30 días a 1 año) y cópiala: Garmin solo la enseña una vez.',
  'Pégala aquí con la misma caducidad y pulsa Conectar.',
] as const;

async function openGarmin(): Promise<void> {
  try {
    await WebBrowser.openBrowserAsync(GARMIN_KEY_URL);
  } catch (err) {
    logger.warn('open garmin key page failed', err);
  }
}

/** 3-step guide + key paste form for the Garmin Personal API. */
export function GarminConnectForm({ today }: { today: ISODate }) {
  const { colors } = useTheme();
  const connect = useConnectGarmin();
  const [apiKey, setApiKey] = useState('');
  const [days, setDays] = useState<number>(GARMIN_EXPIRY_OPTIONS[1]?.days ?? 90);
  const [error, setError] = useState<string | null>(null);
  const keyError = apiKey ? garminKeyError(apiKey) : null;
  const expiresAt = expiryDateFor(days, today);

  const onConnect = async () => {
    const problem = garminKeyError(apiKey);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    try {
      await connect.mutateAsync({ apiKey: apiKey.trim(), expiresAt });
      setApiKey('');
      haptics.success();
    } catch (err) {
      logger.warn('garmin connect failed', err);
      haptics.warning();
      setError(errorMessage(err, 'Garmin no aceptó la clave. Revisa que la copiaste entera.'));
    }
  };

  return (
    <View style={styles.wrap}>
      {STEPS.map((text, index) => (
        <View key={text} style={styles.step}>
          <View style={[styles.num, { backgroundColor: colors.inverseBg }]}>
            <Text variant="metricSmall" style={{ color: colors.inverseText, fontSize: 16, lineHeight: 18 }}>
              {index + 1}
            </Text>
          </View>
          <Text variant="callout" style={styles.flex}>
            {text}
          </Text>
        </View>
      ))}
      <Button label="Abrir Garmin Connect" variant="secondary" icon="link" onPress={() => void openGarmin()} />
      <TextField
        label="Clave Personal API"
        value={apiKey}
        onChangeText={setApiKey}
        placeholder="Pega aquí tu clave"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        textContentType="none"
        error={keyError}
      />
      <View style={styles.block}>
        <Text variant="overline" color="textMuted">
          Caducidad que elegiste en Garmin
        </Text>
        <View style={styles.chips}>
          {GARMIN_EXPIRY_OPTIONS.map((option) => (
            <Chip key={option.days} label={option.label} selected={days === option.days} onPress={() => setDays(option.days)} />
          ))}
        </View>
        <Text variant="caption" color="textMuted">
          Caduca el {formatDateShort(expiresAt)}. Te avisaremos antes para que la renueves.
        </Text>
      </View>
      {error ? <ErrorNotice message={error} /> : null}
      <Button
        label="Conectar"
        icon="link"
        size="lg"
        fullWidth
        loading={connect.isPending}
        disabled={!apiKey || Boolean(keyError)}
        onPress={() => void onConnect()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  step: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  num: { width: 26, height: 26, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  block: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
