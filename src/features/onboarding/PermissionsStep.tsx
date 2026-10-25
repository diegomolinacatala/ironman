import { Platform, StyleSheet, View } from 'react-native';

import { useCalendarIntegration, useHealthIntegration, useNotificationPermission } from '@/integrations/hooks';
import { Card, Divider, Text, space } from '@/ui';

import { PermissionRow, toPermissionState, type PermissionState } from '../settings/PermissionRow';

const IS_WEB = Platform.OS === 'web';

/** Onboarding step 6: optional notifications, calendar and Apple Health access. */
export function PermissionsStep() {
  const notifications = useNotificationPermission();
  const calendar = useCalendarIntegration();
  const health = useHealthIntegration();

  const notificationState: PermissionState = IS_WEB ? 'unavailable' : toPermissionState(notifications.status);
  const calendarState: PermissionState = IS_WEB ? 'unavailable' : toPermissionState(calendar.permission);
  const healthState: PermissionState = !health.available ? 'unavailable' : health.enabled ? 'granted' : 'undetermined';

  return (
    <View style={styles.wrap}>
      <Card padding="md">
        <PermissionRow
          icon="bell"
          title="Notificaciones"
          description="Recordatorio antes de cada entreno, resumen por la mañana, check-in por la noche y avisos de quedadas."
          state={notificationState}
          actionLabel="Activar avisos"
          onRequest={() => notifications.request()}
        />
        <Divider />
        <PermissionRow
          icon="week"
          title="Calendario"
          description="Leemos tus clases y reuniones para no plantarte un entreno encima. Tus amigos solo ven “ocupado”."
          state={calendarState}
          actionLabel="Dar acceso"
          onRequest={() => calendar.request()}
        />
        <Divider />
        <PermissionRow
          icon="health"
          title="Apple Salud"
          description="Si tu Garmin sincroniza con Salud, marcamos solos los entrenos hechos y leemos sueño y pulso."
          state={healthState}
          actionLabel="Conectar Salud"
          onRequest={() => health.connect()}
        />
      </Card>
      <Text variant="caption" color="textMuted">
        {IS_WEB
          ? 'Estás en la versión web: estos permisos se activan en la app del iPhone.'
          : 'Garmin y tu Claude se conectan después, en Yo → Conexiones y Yo → Conecta tu Claude.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
});
