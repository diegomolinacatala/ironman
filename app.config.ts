import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Expo app config. The iOS project is generated from this file (`npx expo prebuild`) on the
 * GitHub Actions Mac that builds and uploads to TestFlight (.github/workflows/ios.yml).
 * Values that differ per account come from env:
 * - APP_BUNDLE_ID: iOS bundle identifier registered in your Apple Developer account.
 * - APPLE_TEAM_ID: Apple Developer team (signing).
 * - IOS_BUILD_NUMBER: CFBundleVersion; CI uses the workflow run number so every upload is unique.
 */
const APP_NAME = 'Road to Ironman';
const BUNDLE_ID = process.env.APP_BUNDLE_ID ?? 'io.github.diegomolinacatala.ironman';
const APP_GROUP = `group.${BUNDLE_ID}`;
const SCHEME = 'roadtoironman';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: APP_NAME,
  slug: 'road-to-ironman',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: SCHEME,
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: BUNDLE_ID,
    buildNumber: process.env.IOS_BUILD_NUMBER ?? '1',
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
    package: BUNDLE_ID,
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
    // TestFlight/App Store builds talk to the production APNs gateway.
    ['expo-notifications', { color: '#D4FF3A', mode: 'production' }],
    [
      'expo-calendar',
      {
        calendarPermission:
          'Road to Ironman lee tus calendarios (clases, trabajo…) para saber cuándo estás ocupado y planificar tus entrenos en huecos libres. Tus amigos solo ven “ocupado”, nunca el título.',
        remindersPermission: false,
      },
    ],
    [
      '@kingstinct/react-native-healthkit',
      {
        NSHealthShareUsageDescription:
          'Road to Ironman lee tus entrenos y su frecuencia cardiaca, sueño, VFC, pulso en reposo, VO2máx y pasos (los que tu reloj sincroniza con Salud) para marcar sesiones como hechas y ajustar tu plan.',
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
  },
});
