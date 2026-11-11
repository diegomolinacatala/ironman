import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button, Icon, Text, space, useTheme, type IconName } from '@/ui';

import { COROS_CALENDAR_PROMPT, COROS_MCP_EU_URL, COROS_PERMISSION_CHECKS, SHARED_THRESHOLDS } from './corosContent';
import { PromptList } from './PromptList';
import { StepCard } from './StepCard';

/** Guide sections 3–5: workouts on the watch, the same thresholds in both apps, and what to do if it fails. */
export function CorosGuideMore() {
  return (
    <>
      <WatchWorkoutsSection />
      <ThresholdsSection />
      <TroubleshootingSection />
    </>
  );
}

/** One idea per line, with an icon (never colour alone). */
function Point({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.point} accessible accessibilityLabel={`${title}. ${text}`}>
      <Icon name={icon} size={16} color={colors.textMuted} />
      <View style={styles.flex}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="callout" color="textMuted">
          {text}
        </Text>
      </View>
    </View>
  );
}

function WatchWorkoutsSection() {
  return (
    <StepCard number={3} title="Tus entrenos en el reloj">
      <Point icon="sparkles" title="Con tu Claude" text="Pasa a tu calendario de COROS los entrenos de carrera y bici. Llegan al reloj cuando sincroniza." />
      <PromptList prompts={[COROS_CALENDAR_PROMPT]} />
      <Point icon="edit" title="A mano" text="En la app COROS: Perfil › Biblioteca de entrenamientos › «+». Copia la sesión del día desde Road to Ironman." />
      <Point icon="swim" title="Natación y fuerza" text="Créalas a mano: COROS aún no deja crearlas desde Claude." />
      <Point icon="brick" title="Brick" text="Son dos entrenos: uno de bici y otro de carrera, seguidos." />
      <Point icon="trash" title="¿Ha cambiado el plan?" text="Claude aún no puede mover ni borrar entrenos en COROS: borra a mano los viejos en la app COROS." />
    </StepCard>
  );
}

function ThresholdsSection() {
  return (
    <StepCard number={4} title="Mismos umbrales en las dos apps">
      <Text variant="callout" color="textMuted">
        Pon los mismos valores en Road to Ironman y en COROS, para que el reloj y la app hablen de las mismas pulsaciones y los
        mismos ritmos:
      </Text>
      <View style={styles.list} accessibilityRole="list">
        {SHARED_THRESHOLDS.map((threshold) => (
          <Text key={threshold} variant="bodyStrong">
            {`· ${threshold}`}
          </Text>
        ))}
      </View>
      <Button label="Abrir tu perfil" variant="secondary" size="sm" icon="profile" onPress={() => router.push('/settings/profile')} />
    </StepCard>
  );
}

function TroubleshootingSection() {
  return (
    <StepCard number={5} title="Si algo falla">
      <Point
        icon="watch"
        title="No llega nada de COROS"
        text="Abre la app COROS con el reloj cerca y espera a que sincronice. Luego, en Tú › Conexiones, pulsa «Sincronizar»."
      />
      <View style={styles.list}>
        {COROS_PERMISSION_CHECKS.map((line) => (
          <Text key={line} variant="caption" color="textMuted">
            {`· ${line}`}
          </Text>
        ))}
      </View>
      <Point icon="sparkles" title="Tu Claude no ve COROS" text="En el chat pulsa «+» y comprueba que COROS y Road to Ironman están activados." />
      <Point icon="plug" title="El conector de COROS falla" text={`Bórralo y añádelo con la URL de Europa: ${COROS_MCP_EU_URL}`} />
      <Point
        icon="copy"
        title="Entrenos repetidos"
        text="Pídele a tu Claude los entrenos solo la primera vez: después llegan solos por Apple Salud."
      />
    </StepCard>
  );
}

const styles = StyleSheet.create({
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  flex: { flex: 1, gap: 2 },
  list: { gap: space.xs },
});
