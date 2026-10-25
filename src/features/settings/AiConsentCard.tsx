import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatConsentDate } from '@/features/coach/aiConsent';
import { AiSharedDataList } from '@/features/coach/AiSharedDataList';
import { useAiConsent } from '@/features/coach/useAiConsent';
import { Card, ErrorNotice, Text, space } from '@/ui';

import { SwitchRow } from './SwitchRow';

export const AI_CONSENT_TITLE = 'Coach IA: compartir datos con Anthropic';

/** Grants or withdraws the Coach IA consent (`profile.aiConsentAt`). */
export function AiConsentCard() {
  const consent = useAiConsent();
  const [error, setError] = useState<string | null>(null);

  if (consent.state === 'not_needed') {
    return (
      <Card padding="lg" style={styles.card}>
        <Text variant="bodyStrong">{AI_CONSENT_TITLE}</Text>
        <Text variant="caption" color="textMuted">
          En modo demo el coach usa el motor de reglas en tu móvil: no se envía nada a Anthropic.
        </Text>
      </Card>
    );
  }

  const given = consent.state === 'given';
  const date = consent.consentAt ? formatConsentDate(consent.consentAt) : '';
  const toggle = async (next: boolean) => {
    setError(null);
    const failure = next ? await consent.grant() : await consent.revoke();
    if (failure) setError(failure);
  };

  return (
    <Card padding="lg" style={styles.card}>
      <SwitchRow
        icon="sparkles"
        title={AI_CONSENT_TITLE}
        subtitle={
          given
            ? `Activado${date ? ` desde el ${date}` : ''}. Si lo desactivas, el coach usará el motor de reglas.`
            : 'Desactivado: el coach usa el motor de reglas y el Coach IA no envía nada a Anthropic.'
        }
        value={given}
        disabled={consent.saving}
        onChange={(next) => void toggle(next)}
      />
      <View style={styles.details}>
        <Text variant="caption" color="textMuted">
          Con el permiso activado, en cada petición enviamos a Anthropic:
        </Text>
        <AiSharedDataList />
      </View>
      {error ? <ErrorNotice message={error} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm },
  details: { gap: space.sm, paddingTop: space.xs },
});
