import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Expo app config. Values that differ per developer/account come from env:
 * - APP_BUNDLE_ID: iOS bundle identifier registered in your Apple Developer account.
 * - APP_VARIANT=development: separate dev-client app that can live next to the TestFlight one.
 * - EXPO_PUBLIC_EAS_PROJECT_ID: set after `npx eas-cli@latest init` (enables push + OTA updates).
 */
const IS_DEV = process.env.APP_VARIANT === 'development';
const BASE_BUNDLE_ID = process.env.APP_BUNDLE_ID ?? 'com.diegomolinacatala.rebufo';
const BUNDLE_ID = IS_DEV ? `${BASE_BUNDLE_ID}.dev` : BASE_BUNDLE_ID;
const APP_GROUP = `group.${BUNDLE_ID}`;
const EAS_PROJECT_ID = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: IS_DEV ? 'Rebufo Dev' : 'Rebufo',
  slug: 'rebufo',
  owner: process.env.EXPO_OWNER,
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: IS_DEV ? 'rebufo-dev' : 'rebufo',
  userInterfaceStyle: 'automatic',
  // Changes automatically whenever native code/config changes, so OTA updates never reach an incompatible binary.
  runtimeVersion: { policy: 'fingerprint' },
  ...(EAS_PROJECT_ID ? { updates: { url: `https://u.expo.dev/${EAS_PROJECT_ID}` } } : {}),
  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: false,
    usesAppleSignIn: true,
    appleTeamId: process.env.APPLE_TEAM_ID,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      UIBackgroundModes: ['remote-notification'],
      CFBundleDevelopmentRegion: 'es',
    },
  },
  android: {
    package: BUNDLE_ID.replace(/-/g, '_'),
    adaptiveIcon: {
      backgroundColor: '#15171A',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
  },
  web: {
    output: 'single',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#F4F1EA',
        dark: { backgroundColor: '#0D0F12' },
        image: './assets/images/splash-icon.png',
        imageWidth: 96,
      },
    ],
    'expo-font',
    ['expo-secure-store', { faceIDPermission: false }],
    ['expo-localization', { supportedLocales: ['es'] }],
    'expo-web-browser',
    'expo-apple-authentication',
    '@react-native-community/datetimepicker',
    'expo-sharing',
    ['expo-notifications', { color: '#D4FF3A' }],
    [
      'expo-calendar',
      {
        calendarPermission:
          'Rebufo lee tus calendarios (clases, trabajo…) para saber cuándo estás ocupado y planificar tus entrenos en huecos libres. Tus amigos solo ven “ocupado”, nunca el título, y el Coach IA solo recibe las horas ocupadas.',
        remindersPermission: false,
      },
    ],
    [
      '@kingstinct/react-native-healthkit',
      {
        NSHealthShareUsageDescription:
          'Rebufo lee tus entrenos y su frecuencia cardiaca, sueño, VFC, pulso en reposo, VO2máx y pasos (los que tu reloj sincroniza con Salud) para marcar sesiones como hechas y ajustar tu plan. Solo si lo autorizas, el Coach IA (Anthropic) recibe un resumen para proponerte cambios.',
        NSHealthUpdateUsageDescription: false,
        background: false,
      },
    ],
    [
      'expo-widgets',
      {
        groupIdentifier: APP_GROUP,
        widgets: [
          {
            name: 'TodayWidget',
            displayName: 'Hoy',
            description: 'Tus entrenos de hoy y mañana',
            ios: {
              supportedFamilies: ['systemSmall', 'systemMedium', 'systemLarge'],
              initialLayout: './src/integrations/widgets/TodayWidget.tsx',
            },
          },
          {
            name: 'RaceWidget',
            displayName: 'Cuenta atrás',
            description: 'Días hasta tu próxima carrera y progreso semanal',
            ios: {
              supportedFamilies: ['systemSmall', 'accessoryCircular', 'accessoryInline'],
              initialLayout: './src/integrations/widgets/RaceWidget.tsx',
            },
          },
          {
            name: 'NextWorkoutWidget',
            displayName: 'Próximo entreno',
            description: 'Tu próximo entreno en la pantalla de bloqueo',
            ios: {
              supportedFamilies: ['accessoryRectangular', 'accessoryInline'],
              initialLayout: './src/integrations/widgets/NextWorkoutWidget.tsx',
            },
          },
        ],
      },
    ],
  ],
  experiments: {
    typedRoutes: false,
    reactCompiler: true,
  },
  extra: {
    appGroup: APP_GROUP,
    ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
  },
});
