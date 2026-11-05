import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RepositoryProvider } from '@/data/RepositoryProvider';
import { AppEffects } from '@/integrations/AppEffects';
import { loadAppearancePreference } from '@/ui/appearance';
import { fonts, useTheme } from '@/ui/theme';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** Deep links (widgets, notifications) open on top of the tabs, so there is always a way back. */
export const unstable_settings = { anchor: '(tabs)' };

function RootNavigator() {
  const { colors, isDark } = useTheme();
  const navTheme = isDark ? DarkTheme : DefaultTheme;
  const header = {
    headerShown: true,
    headerShadowVisible: false,
    headerStyle: { backgroundColor: colors.bg },
    headerTintColor: colors.text,
    headerTitleStyle: { fontFamily: fonts.bodySemibold, fontSize: 17 },
    headerBackButtonDisplayMode: 'minimal' as const,
    contentStyle: { backgroundColor: colors.bg },
  };
  const modal = { ...header, presentation: 'modal' as const };

  return (
    <ThemeProvider
      value={{ ...navTheme, colors: { ...navTheme.colors, background: colors.bg, card: colors.bg, text: colors.text, border: colors.border, primary: colors.text } }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="verify" options={{ ...header, title: '' }} />
        <Stack.Screen name="auth/callback" options={{ gestureEnabled: false }} />
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />

        <Stack.Screen name="workout/[id]" options={{ ...header, title: 'Entreno' }} />
        <Stack.Screen name="workout/edit" options={{ ...modal, title: 'Entreno' }} />
        <Stack.Screen name="event/edit" options={{ ...modal, title: 'Imprevisto' }} />
        <Stack.Screen name="checkin" options={{ ...modal, title: '¿Cómo estás hoy?' }} />

        <Stack.Screen name="talk" options={{ presentation: 'fullScreenModal', gestureEnabled: true }} />
        <Stack.Screen name="meal" options={{ ...modal, title: 'Comida' }} />
        <Stack.Screen name="briefing" options={{ ...modal, title: 'Informe de hoy' }} />

        <Stack.Screen name="coach" options={{ ...header, title: 'Coach' }} />
        <Stack.Screen name="proposal/[id]" options={{ ...modal, title: 'Propuesta' }} />
        <Stack.Screen name="races/index" options={{ ...header, title: 'Carreras' }} />
        <Stack.Screen name="races/edit" options={{ ...modal, title: 'Carrera' }} />
        <Stack.Screen name="nutrition" options={{ ...header, title: 'Nutrición' }} />

        <Stack.Screen name="friends/add" options={{ ...modal, title: 'Añadir amigo' }} />
        <Stack.Screen name="friends/[id]" options={{ ...header, title: 'Juntos' }} />
        <Stack.Screen name="joint/new" options={{ ...modal, title: 'Entrenar juntos' }} />
        <Stack.Screen name="joint/[id]" options={{ ...header, title: 'Quedada' }} />
        <Stack.Screen name="notifications" options={{ ...header, title: 'Avisos' }} />

        <Stack.Screen name="settings/profile" options={{ ...header, title: 'Perfil' }} />
        <Stack.Screen name="settings/availability" options={{ ...header, title: 'Disponibilidad' }} />
        <Stack.Screen name="settings/notifications" options={{ ...header, title: 'Notificaciones' }} />
        <Stack.Screen name="settings/voice" options={{ ...header, title: 'Voz del coach' }} />
        <Stack.Screen name="settings/integrations" options={{ ...header, title: 'Conexiones' }} />
        <Stack.Screen name="settings/claude" options={{ ...header, title: 'Conecta tu Claude' }} />
        <Stack.Screen name="settings/calendar-feed" options={{ ...header, title: 'Suscripción de calendario' }} />
        <Stack.Screen name="privacy" options={{ ...header, title: 'Privacidad' }} />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  // The stored light/dark choice is applied before the first frame (no flash of the other scheme).
  const [appearanceReady, setAppearanceReady] = useState(false);
  useEffect(() => {
    void loadAppearancePreference().finally(() => setAppearanceReady(true));
  }, []);

  const ready = (loaded || Boolean(error)) && appearanceReady;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <RepositoryProvider>
          <AppEffects />
          <RootNavigator />
        </RepositoryProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
