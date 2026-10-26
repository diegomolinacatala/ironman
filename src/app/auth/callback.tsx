import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { useAuth } from '@/data/context';
import { authErrorMessage } from '@/features/account/authErrors';
import { Button, ErrorNotice, Loading, Screen } from '@/ui';

/**
 * Landing route of the sign-in email link (roadtoironman://auth/callback?code=…):
 * exchanges the one-time code for a session, then lets the entry gate decide
 * between onboarding and the tabs.
 */
export default function AuthCallback() {
  const { auth } = useAuth();
  const params = useLocalSearchParams<{ code?: string; error_description?: string }>();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!params.code) {
      setError(params.error_description ?? 'El enlace no es válido o ha caducado. Pide uno nuevo.');
      return;
    }
    auth
      .completeEmailLink(params.code)
      .then(() => router.replace('/'))
      .catch((err: unknown) => setError(authErrorMessage(err, 'El enlace ha caducado o ya se usó. Pide uno nuevo.')));
  }, [auth, params.code, params.error_description]);

  if (!error) {
    return (
      <Screen scroll={false}>
        <Loading label="Entrando…" />
      </Screen>
    );
  }
  return (
    <Screen title="No hemos podido entrar">
      <ErrorNotice message={error} />
      <Button label="Volver a intentarlo" onPress={() => router.replace('/sign-in')} fullWidth />
    </Screen>
  );
}
