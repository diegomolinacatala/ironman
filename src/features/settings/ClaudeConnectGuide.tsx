import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Text, space } from '@/ui';

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
            Dentro de la app, sin salir de ella: le hablas y recoloca tu semana. Sin conexión usa reglas.
          </Text>
        </View>
      </View>
      <Button label="Hablar con tu coach" variant="ghost" icon="mic" onPress={() => router.push('/talk')} />
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, gap: 2 },
  compare: { flexDirection: 'row', gap: space.lg, marginTop: space.sm, marginBottom: space.sm },
});
