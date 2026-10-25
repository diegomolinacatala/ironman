import { router } from 'expo-router';

import { Card, ListRow } from '@/ui';

export interface PrivacyLinkRowProps {
  title?: string;
  subtitle?: string;
}

/** Row that opens the Privacidad screen (policy summary + Coach IA permission). */
export function PrivacyLinkRow({
  title = 'Política de privacidad',
  subtitle = 'Qué datos usamos, con quién y el permiso del Coach IA',
}: PrivacyLinkRowProps) {
  return (
    <Card padding="md">
      <ListRow icon="lock" title={title} subtitle={subtitle} onPress={() => router.push('/privacy')} />
    </Card>
  );
}
