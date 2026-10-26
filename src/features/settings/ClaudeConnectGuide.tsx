import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { logger } from '@/lib/logger';
import { Button, Card, ErrorNotice, Icon, Text, space, useTheme } from '@/ui';

import { PromptList } from './PromptList';
import { SecretUrlBox } from './SecretUrlBox';
import { StepCard } from './StepCard';
import type { TokenGenerator } from './useTokenGenerator';

export const CLAUDE_CONNECTORS_URL = 'https://claude.ai/settings/connectors';

async function openConnectors(): Promise<void> {
  try {
    await WebBrowser.openBrowserAsync(CLAUDE_CONNECTORS_URL);
  } catch (err) {
    logger.warn('open claude connectors failed', err);
  }
}

/** Step 1: generate the personal connector URL (shown once). */
export function GenerateUrlStep({ generator, isDemo }: { generator: TokenGenerator; isDemo: boolean }) {
  const { created, generate, generating, error, activeCount, limitReached } = generator;
  return (
    <StepCard number={1} title="Genera tu URL personal" done={Boolean(created)}>
      {created ? (
        <SecretUrlBox
          label="Tu URL de conector"
          url={created.url}
          warning="Esta URL funciona como una contraseña: quien la tenga puede leer y proponer cambios en tu plan. No la compartas. Solo la verás ahora; si la pierdes, genera otra y revoca esta."
        />
      ) : (
        <>
          <Text variant="callout" color="textMuted">
            Es un enlace secreto y personal que identifica tu cuenta ante Claude, sin contraseñas.
          </Text>
          {activeCount > 0 ? (
            <Text variant="caption" color="textMuted">
              Ya tienes {activeCount} URL activa(s). Generar otra no invalida las anteriores: revócalas abajo si ya no las usas.
            </Text>
          ) : null}
          <Button
            label="Generar mi URL"
            icon="key"
            size="lg"
            fullWidth
            loading={generating}
            disabled={limitReached}
            onPress={() => void generate()}
          />
          {limitReached ? (
            <Text variant="caption" color="warning">
              Tienes el máximo de 5 URL activas. Revoca alguna para crear otra.
            </Text>
          ) : null}
        </>
      )}
      {isDemo && created ? (
        <Text variant="caption" color="warning">
          Modo demo: esta URL es de ejemplo y no funcionará en Claude hasta que configures el servidor.
        </Text>
      ) : null}
      {error ? <ErrorNotice message={error} /> : null}
    </StepCard>
  );
}

const CONNECTOR_STEPS = [
  'Abre claude.ai (web o escritorio) → Ajustes → Conectores.',
  'Pulsa “Añadir conector personalizado”, ponle de nombre Road to Ironman y pega tu URL.',
  'Deja la autenticación como “sin inicio de sesión” y guarda.',
] as const;

/** Step 2: add the custom connector in claude.ai. */
export function AddConnectorStep() {
  const { colors } = useTheme();
  return (
    <StepCard number={2} title="Añádelo en Claude">
      {CONNECTOR_STEPS.map((text) => (
        <View key={text} style={styles.bullet}>
          <Icon name="chevronRight" size={12} color={colors.textMuted} />
          <Text variant="callout" style={styles.flex}>
            {text}
          </Text>
        </View>
      ))}
      <Button label="Abrir conectores de Claude" variant="secondary" icon="link" onPress={() => void openConnectors()} />
      <Text variant="caption" color="textMuted">
        Una vez añadido, el conector funciona también en la app de Claude del iPhone. Necesitas un plan que permita
        conectores personalizados (en el gratuito solo cabe uno).
      </Text>
    </StepCard>
  );
}

/** Step 3: example prompts. */
export function UseItStep() {
  return (
    <StepCard number={3} title="Úsalo en un chat">
      <Text variant="callout" color="textMuted">
        En el chat, en “+ → Conectores”, activa Road to Ironman y tu conector de Garmin. Luego pide, por ejemplo:
      </Text>
      <PromptList />
      <Text variant="caption" color="textMuted">
        Los cambios llegan como propuesta: te avisamos y los aceptas o descartas en la app.
      </Text>
    </StepCard>
  );
}

/** How "Tu Claude" differs from the in-app Coach IA. Only shown while the AI coach is switched on. */
export function CoachDifferenceCard() {
  return (
    <Card padding="lg" variant="tinted">
      <Text variant="overline" color="textMuted">
        ¿Y el Coach IA de la app?
      </Text>
      <View style={styles.compare}>
        <View style={styles.flex}>
          <Text variant="bodyStrong">Tu Claude</Text>
          <Text variant="caption" color="textMuted">
            Tu suscripción, tus chats y tus otros conectores (Garmin, calendario, comidas). Ideal para planificar a fondo.
          </Text>
        </View>
        <View style={styles.flex}>
          <Text variant="bodyStrong">Coach IA</Text>
          <Text variant="caption" color="textMuted">
            Dentro de la app, sin salir de ella: replanes rápidos tras un imprevisto. Sin conexión usa reglas.
          </Text>
        </View>
      </View>
      <Button label="Abrir el Coach IA" variant="ghost" icon="coach" onPress={() => router.push('/coach')} />
    </Card>
  );
}

const styles = StyleSheet.create({
  bullet: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', paddingTop: 2 },
  flex: { flex: 1, gap: 2 },
  compare: { flexDirection: 'row', gap: space.lg, marginTop: space.sm, marginBottom: space.sm },
});
