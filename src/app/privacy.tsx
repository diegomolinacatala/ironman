/**
 * Privacidad: summary of docs/PRIVACY.md, the Coach IA consent switch and a
 * link to the full policy (EXPO_PUBLIC_PRIVACY_URL).
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AiConsentCard } from '@/features/settings/AiConsentCard';
import { PRIVACY_POLICY_URL, PRIVACY_SUMMARY, openPrivacyPolicy } from '@/features/settings/privacyPolicy';
import { PrivacySummarySection } from '@/features/settings/PrivacySummary';
import { Button, ErrorNotice, Screen, SectionHeader, Text, space } from '@/ui';

export default function PrivacyScreen() {
  const [error, setError] = useState<string | null>(null);
  // Coach IA switch goes right after "Quién más los ve" (which points to it).
  const [uses, sharing, ...rest] = PRIVACY_SUMMARY;

  const openPolicy = async () => {
    setError(null);
    if (!(await openPrivacyPolicy())) setError('No se ha podido abrir la política. Inténtalo de nuevo.');
  };

  return (
    <Screen inSheet>
      <Text variant="callout" color="textMuted">
        Lo esencial de cómo cuidamos tus datos. No vendemos datos, no hay publicidad y no usamos tu salud para
        marketing. La política completa es la que manda.
      </Text>
      {uses ? <PrivacySummarySection section={uses} /> : null}
      {sharing ? <PrivacySummarySection section={sharing} /> : null}
      <View>
        <SectionHeader title="Coach IA" />
        <AiConsentCard />
      </View>
      {rest.map((section) => (
        <PrivacySummarySection key={section.title} section={section} />
      ))}
      {PRIVACY_POLICY_URL ? (
        <Button label="Ver política completa" icon="link" variant="secondary" fullWidth onPress={() => void openPolicy()} />
      ) : (
        <Text variant="caption" color="textMuted" style={styles.note}>
          La política completa se publicará junto a la app en la App Store.
        </Text>
      )}
      {error ? <ErrorNotice message={error} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { paddingHorizontal: space.xs },
});
