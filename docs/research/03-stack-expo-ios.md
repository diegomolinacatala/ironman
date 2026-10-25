# 03 — Stack técnico: Expo SDK 58 + iOS (desarrollando desde Windows)

> Investigación técnica para el MVP de la app de planificación de triatlón (nombre provisional en los ejemplos: **TriPlan**, scheme `triplan`, bundle `com.example.triplan`; son **placeholders**).
> Fecha de la investigación: **2026-10-25**. Versiones verificadas en npm ese mismo día.
> Leyenda de fiabilidad: ✅ verificado en doc oficial / código fuente del paquete · ⚠️ fuente secundaria o parcialmente verificado · ❓ no verificado, comprobar antes de depender de ello.
> Documentos relacionados: `04-integracion-garmin.md` (Garmin), `05-claude-mcp-supabase.md` (Claude/MCP/backend).

---

## 0. Resumen de decisiones (TL;DR)

| Tema | Decisión | Motivo |
|---|---|---|
| SDK | **Expo SDK 58** (`expo@58.0.19`, RN 0.88.0, React 19.3.0) | Última estable (15-oct-2026), soporte iOS 27, native tabs estables |
| Plantilla | `npx create-expo-app@latest triplan --template default@sdk-58` | Trae `src/app`, Expo Router, NativeTabs, typed routes, React Compiler |
| Navegación | **Expo Router 58** con `NativeTabs` (`expo-router/native-tabs`) + `Stack` por pestaña + `formSheet` para "imprevisto"/"editar sesión" | Tab bar nativa (Liquid Glass en iOS 26+), cero JS custom |
| Widgets | **`expo-widgets` (first-party)** con `@expo/ui/swift-ui` | Estable desde SDK 56, sin Swift ni Xcode (ideal desde Windows), timelines, lock screen, `widgetURL` |
| Plan B widgets | `@bacons/apple-targets@5.0.0` + SwiftUI escrito a mano | Solo si se necesita algo que expo-widgets no soporte |
| HealthKit | **`@kingstinct/react-native-healthkit@16.2.0`** + `react-native-nitro-modules@0.37.x` | API tipada, Nitro, plugin Expo, background delivery |
| Notificaciones | `expo-notifications@58.1.6` locales (recordatorios) + push vía **Expo Push API** desde Supabase Edge Functions | Sin servidor propio; ojo al límite de 64 locales pendientes |
| Calendario | `expo-calendar@58.0.6` **API nueva orientada a objetos** (`getCalendars`, `listEvents`), acceso completo (no write-only) | La API legacy lanza excepción en runtime en SDK 58 |
| Backend | `@supabase/supabase-js@2.118.0`, **clave publishable** (`sb_publishable_…`), sesión en `expo-sqlite/localStorage` | Las claves `anon`/`service_role` se deprecan a finales de 2026 |
| Login | **Email OTP (código de 6 dígitos)** + **Sign in with Apple nativo** (`signInWithIdToken` con nonce) | Sin deep links de magic link; Apple nativo sin secretos |
| Build | **EAS Build en la nube** (Mac remoto, Xcode 27.1) desde Windows; credenciales gestionadas por EAS | No hace falta Mac |
| Distribución | `eas build -p ios --profile production --auto-submit` → **TestFlight interno** (compañero como usuario de App Store Connect) | Sin Beta App Review, builds disponibles en minutos |
| OTA | `expo-updates` + EAS Update, `runtimeVersion: { policy: 'fingerprint' }` | Ahorra builds (el plan Free tiene 15 builds iOS/mes) |
| Tests | `jest-expo@58` (Jest 30) + `@testing-library/react-native@14` (API async) + `expo-router/testing-library` | Requisito explícito de SDK 58 |

---

## 1. Expo SDK 58

### 1.1 Versiones (verificadas en npm el 2026-10-25) ✅

| Paquete | Versión | Nota |
|---|---|---|
| `expo` | 58.0.19 | SDK 58 publicado el 15-oct-2026 |
| `react-native` | 0.88.0 | SDK 58 sube de 0.86 → 0.88 (incluye cambios de 0.87 y 0.88) |
| `react` / `react-dom` | 19.3.0 | (SDK 55–57 usaban React 19.2) |
| `typescript` | ~6.0.3 | en la plantilla por defecto |
| `react-native-web` | ~0.21.4 | |
| `expo-router` | 58.0.26 | |
| `@expo/ui` | 58.0.23 | incluido en la plantilla por defecto |
| `expo-widgets` | 58.0.23 | |
| `react-native-reanimated` / `react-native-worklets` | 4.7.1 / 0.13.0 | |
| `react-native-gesture-handler` | ~3.3.0 | |
| `react-native-screens` | ~4.30.0 | |
| `expo-notifications` | 58.1.6 | |
| `expo-calendar` | 58.0.6 | |
| `expo-updates` | 58.0.18 | |
| `expo-dev-client` | 58.0.15 | |
| `jest-expo` | 58.0.12 | requiere Jest 30 |
| `@testing-library/react-native` | 14.1.0 | |
| `eas-cli` | 25.3.0 | |

Requisitos de plataforma:

- **iOS mínimo: 16.4** (subido en SDK 56; `ExpoModulesCore.podspec` de 58.0.26 declara `:ios => '16.4'`) ✅. Deja fuera iPhone 7/6s/SE 1ª gen.
- **Node.js: 22.13+, 24.3+ o 26+** (no se soportan versiones impares) ✅.
- **EAS Build**: los alias de imagen `sdk-58` y `latest` apuntan a **Xcode 27.1** ✅. Si `eas.json` fija una imagen concreta, cambiarla a uno de esos alias.
- **New Architecture obligatoria**: la Legacy Architecture se eliminó en SDK 55 (la opción `newArchEnabled` ya no existe) ✅. Todo lo que usamos (Nitro, Expo Modules) es New Arch.
- **Hermes v1** es el motor por defecto desde SDK 56 ✅.

### 1.2 Crear el proyecto

```bash
# Desde Windows (PowerShell o Git Bash), Node 22.13+ o 24.3+
npx create-expo-app@latest triplan --template default@sdk-58
cd triplan
npx expo install expo-dev-client
```

- ⚠️ Durante la transición a SDK 58, la doc dice que `create-expo-app@latest` **sin** `--template` puede crear un proyecto SDK 57 (pensado para quien quiere usar Expo Go). **Fijar siempre `default@sdk-58`.**
- `create-expo-app` genera también `AGENTS.md` y `.claude/settings.json` (se desactiva con `--no-agents-md`).
- Upgrade de un proyecto existente: `npx expo install expo@^58.0.0 --fix` y luego `npx expo-doctor@latest`.

### 1.3 Qué contiene la plantilla `default@sdk-58` ✅ (inspeccionada en `expo-template-default@58.0.28`)

```
assets/                     # iconos, splash, tabIcons, expo.icon (icono iOS formato Icon Composer)
scripts/reset-project.js    # "npm run reset-project" deja un proyecto vacío
src/
  app/
    _layout.tsx             # ThemeProvider + AnimatedSplashOverlay + <AppTabs/>
    index.tsx
    explore.tsx
  components/
    app-tabs.tsx            # NativeTabs (iOS/Android)
    app-tabs.web.tsx        # Tabs headless de expo-router/ui para web
    animated-icon(.web).tsx, themed-text.tsx, themed-view.tsx, external-link.tsx, ui/...
  constants/theme.ts
  hooks/
  global.css
app.json · package.json · tsconfig.json
```

`app.json` de la plantilla (resumen): `scheme: "helloworld"`, `userInterfaceStyle: "automatic"`, `ios.icon: "./assets/expo.icon"`, `web.output: "server"`, plugins `expo-router` y `expo-splash-screen`, y:

```json
"experiments": { "typedRoutes": true, "reactCompiler": true }
```

`tsconfig.json`: `extends: "expo/tsconfig.base"`, `strict: true`, alias `"@/*": ["./src/*"]` y `"@/assets/*": ["./assets/*"]`, e incluye `.expo/types/**/*.ts` y `expo-env.d.ts` (tipos de rutas generados).

Dependencias de la plantilla (además de las de la tabla): `expo-image`, `expo-symbols`, `expo-glass-effect`, `expo-device`, `expo-linking`, `expo-web-browser`, `expo-system-ui`, `expo-status-bar`, `expo-splash-screen`, `expo-font`, `react-native-safe-area-context`.

Soporte `src/app` ✅: desde SDK 55 la plantilla pone el código en `src/app`. Si existen `app/` y `src/app/`, **gana `src/app`**. Los ficheros de config (`app.config.ts`, `package.json`, `metro.config.js`, `tsconfig.json`) y `public/` siguen en la raíz.

### 1.4 Breaking changes de SDK 58 que nos afectan ✅

- **TypeScript estricto de React Native por defecto**: importaciones profundas `react-native/Libraries/*` dan error de tipos; las refs usan tipos de instancia (`ViewInstance`, `TextInputInstance`).
- Eliminados: `InteractionManager` (usar `requestIdleCallback`), export raíz `Touchable`, prop `animated` de `Modal`, props `backgroundColor`/`translucent`/`networkActivityIndicatorVisible` de `StatusBar`. `ImageBackground` deprecado.
- **iOS: ciclo de vida basado en escenas** (`SceneDelegate.swift` generado por prebuild). Si se tenía `ios.enableSceneSupport` en `expo-build-properties` (SDK 57), quitarlo.
- **iOS 27: las apps de iPhone son redimensionables**; `requireFullScreen` ya no lo evita y `ScreenOrientation.lockAsync` puede no tener efecto → diseñar layouts flexibles.
- **Expo Router**: `expo-router/unstable-native-tabs` → `expo-router/native-tabs`; `withLayoutContext` deprecado (usar `integrateWithRouter`); en iOS 26+ la cabecera de `Stack` es transparente con Liquid Glass y el contenido pasa por debajo; `expo-symbols` y `@expo/ui` pasan a ser peer deps opcionales.
- **Web**: si `web.output` no está definido → `"server"` por defecto; rutas troceadas en chunks (`asyncRoutes: { web: false }` para desactivarlo).
- **expo-notifications**: las notificaciones en primer plano **se muestran por defecto**.
- `expo-file-system`: `File.write()` es async (usar `writeSync()` para el comportamiento anterior).
- `NODE_ENV` lo fija Expo CLI según el comando.
- Fingerprint: preset `balanced` por defecto.

### 1.5 Expo Router: piezas útiles para esta app

#### 1.5.1 Native Tabs ✅

Importación en SDK 58: `expo-router/native-tabs` (en SDK 55–57 era `unstable-native-tabs`). Cada ruta necesita su `NativeTabs.Trigger` (no aparecen automáticamente).

Propuesta de pestañas: **Hoy** · **Semana** · **Amigos** · **Coach** (Claude) · **Perfil**.

```tsx
// src/components/app-tabs.tsx  (patrón de la plantilla SDK 58, adaptado)
import { NativeTabs } from 'expo-router/native-tabs';

export default function AppTabs() {
  return (
    <NativeTabs minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="(today)">
        <NativeTabs.Trigger.Label>Hoy</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'sun.max', selected: 'sun.max.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(week)">
        <NativeTabs.Trigger.Label>Semana</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="calendar" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(friends)">
        <NativeTabs.Trigger.Label>Amigos</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.2" />
        <NativeTabs.Trigger.Badge>2</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(coach)">
        <NativeTabs.Trigger.Label>Coach</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="sparkles" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(profile)">
        <NativeTabs.Trigger.Label>Perfil</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.crop.circle" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
```

Notas ✅:
- `Icon` acepta `sf` (SF Symbols, iOS), `md` (Material Symbols, Android; requiere instalar `expo-symbols`) o `src` (imagen, con `renderingMode` `template`/`original` en iOS). `sf`/`md` aceptan `{ default, selected }`.
- **Native tabs no tienen cabecera**: anidar un `Stack` dentro de cada carpeta de pestaña (`src/app/(week)/_layout.tsx` → `<Stack />`) para headers y navegación push.
- En iOS 26 la tab bar es Liquid Glass; `backgroundColor` solo afecta a iOS ≤ 18. Para evitar flashes blancos envolver en `ThemeProvider` (`DarkTheme`/`DefaultTheme` de `expo-router`).
- Límite de 5 pestañas **solo en Android**. No se pueden anidar native tabs dentro de native tabs ni añadir/quitar pestañas en runtime.
- En web usa una implementación básica tipo iPad; la plantilla ya trae `app-tabs.web.tsx` con `Tabs`/`TabList`/`TabTrigger`/`TabSlot` de `expo-router/ui`.

#### 1.5.2 Modales y form sheets ✅

Ideal para "➕ Imprevisto" (pádel, fútbol, lesión, estrés…) y "Editar sesión": hoja nativa con detents.

```tsx
// src/app/_layout.tsx  (raíz: Stack que contiene las tabs y las hojas)
import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="add-event"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [0.5, 1],   // fracciones de pantalla; también 'fitToContents'
          sheetInitialDetentIndex: 0,
          sheetGrabberVisible: true,       // solo iOS
          sheetCornerRadius: 24,
          headerShown: false,
        }}
      />
      <Stack.Screen name="session/[id]" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
```

- Android admite como máximo 3 detents; iOS cualquier número. Desde SDK 55 `flex: 1` funciona en iOS con detents numéricos (no con `fitToContents`).
- ⚠️ Estructura de carpetas: con la plantilla SDK 58, `NativeTabs` vive en el `_layout.tsx` raíz. Para tener hojas por encima de las tabs, mover las tabs a un grupo `(tabs)/_layout.tsx` y dejar un `Stack` en la raíz (patrón estándar; comprobar en dispositivo cómo se comporta la hoja sobre la tab bar Liquid Glass).

#### 1.5.3 Typed routes ✅

Ya activado en la plantilla (`experiments.typedRoutes: true`). Expo CLI genera `expo-env.d.ts` (gitignored) y tipos en `.expo/types`. Uso:

```tsx
import { Link, router } from 'expo-router';

<Link href={{ pathname: '/session/[id]', params: { id: session.id } }}>Ver</Link>;
router.push('/add-event');
```

#### 1.5.4 Deep links ✅

- Definir `scheme` en la config (`"scheme": "triplan"`) → requiere nueva build nativa. Expo Router enlaza automáticamente `triplan://session/123` con `src/app/session/[id].tsx`.
- Probar: `npx uri-scheme open triplan://session/123 --ios`.
- `+native-intent.tsx` en la raíz de `app` (exporta `redirectSystemPath`) permite reescribir URLs entrantes (útil para enlaces de widgets/notificaciones antiguos).
- Universal links (https) quedan fuera del MVP.

#### 1.5.5 Navegar al tocar una notificación ✅ (patrón de la doc, adaptado)

```tsx
// src/hooks/use-notification-observer.ts
import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

export function useNotificationObserver() {
  useEffect(() => {
    function redirect(notification: Notifications.Notification) {
      const url = notification.request.content.data?.url;
      if (typeof url === 'string') router.push(url as never);
    }
    const last = Notifications.getLastNotificationResponse();
    if (last?.notification) {
      redirect(last.notification);
      Notifications.clearLastNotificationResponse();
    }
    const sub = Notifications.addNotificationResponseReceivedListener((r) => redirect(r.notification));
    return () => sub.remove();
  }, []);
}
```

(Llamarlo en `src/app/_layout.tsx`.) ❓ En la doc v58 `getLastNotificationResponse()` aparece como síncrono; si el tipo devuelve Promise, añadir `await`.

### 1.6 Preview web (react-native-web) desde Windows

- `npx expo start --web` funciona en Windows y es el bucle más rápido para **UI y lógica** (sin Mac ni iPhone).
- **No funcionan en web**: HealthKit, widgets, notificaciones locales/push nativas, expo-calendar, Sign in with Apple nativo. Aislar cada integración nativa tras una interfaz (`src/services/health/index.ts` con `health.ios.ts` y `health.web.ts`/`health.ts` stub). El paquete de HealthKit ya trae `healthkit.ts` (stub no-iOS) y `healthkit.ios.ts` ⚠️ (comprobar el comportamiento en web).
- Como usamos Supabase directamente (sin API routes), fijar `"web": { "output": "single" }` o `"static"` en vez del `"server"` de la plantilla para no necesitar hosting con servidor.

### 1.7 Bucle de desarrollo recomendado sin Mac

| Opción | ¿Sirve aquí? | Comentario |
|---|---|---|
| Expo Go | ❌ | No soporta módulos nativos propios (HealthKit, widgets), ni push en dev. El Expo Go de SDK 58 estaba aún pendiente de publicarse en App Store según el post del 15-oct-2026. |
| **Development build vía EAS** (`expo-dev-client`) | ✅ | Una build por cambio nativo; los cambios JS se recargan en caliente desde el PC. |
| Simulador iOS | ❌ | Requiere Mac. |
| Web | ✅ (parcial) | UI/lógica. |

Flujo: `eas device:create` (registrar los dos iPhones) → `eas build -p ios --profile development` → instalar desde el enlace/QR → `npx expo start` (o `npx expo start --tunnel` si el firewall de Windows/la red impide la conexión LAN). ⚠️ En iOS 16+ hay que activar **Modo desarrollador** en el iPhone (Ajustes > Privacidad y seguridad) para builds ad hoc/dev.

---

## 2. Widgets de iOS

### 2.1 Estado en 2026 ✅

- **Sí existe solución first-party: `expo-widgets`** (Expo UI). Alfa en SDK 55, **estable en SDK 56** (anuncio de 18-jun-2026), y en **SDK 58 añade implementación Android** (runtime Hermes propio, interacciones, Material Colors) y `staleDate` para Live Activities.
- Se escribe el widget como **componente React** con la directiva `'widget'` usando componentes de `@expo/ui/swift-ui`; CNG genera el target Widget Extension, el App Group y el andamiaje SwiftUI.
- No funciona en Expo Go (requiere development build).
- ⚠️ Un artículo de terceros (reactnativerelay.com, 15-ago-2026) sigue llamándolo "alpha"; **contradice la doc y el changelog oficiales** (estable desde SDK 56) → considerarlo desactualizado.

### 2.2 Comparativa

| Criterio | `expo-widgets@58` | `@bacons/apple-targets@5.0.0` |
|---|---|---|
| Mantenedor | Expo (first-party, versionado con el SDK) | Evan Bacon (comunidad; v5.0.0 publicada 17-jul-2026, peer `expo >=52`) |
| Lenguaje del widget | TSX con `@expo/ui/swift-ui` (se traduce a SwiftUI) | **Swift/SwiftUI a mano** en `targets/<nombre>/` |
| Necesita Xcode/Mac para iterar | No (solo EAS Build) | En la práctica sí (previews, errores de compilación Swift); sin Mac solo ves errores en la build de EAS |
| App Group | Automático (`groupIdentifier`, por defecto `group.<bundleId>`) | Manual en `ios.entitlements` + `expo-target.config.js` |
| Compartir datos | Props: `updateSnapshot` / `updateTimeline`; imágenes en `widgetsDirectory` | `ExtensionStorage` (wrapper de `UserDefaults(suiteName:)`) + `reloadWidget()` |
| Timelines | Sí (`updateTimeline([{date, props}])`) | Sí, en Swift (`TimelineProvider`) |
| Lock screen (accessory*) | Sí: `accessoryCircular`, `accessoryRectangular`, `accessoryInline` | Sí (SwiftUI nativo) |
| Interactivo (iOS 17+) | Sí: `Button onPress` devuelve nuevas props sin abrir la app | Sí, con App Intents en Swift |
| Deep link al tocar | Modificador `widgetURL(url)` de `@expo/ui/swift-ui/modifiers` | `.widgetURL(...)` / `Link` en SwiftUI |
| Configurable por el usuario | Sí (`ios.configuration`, iOS 17+) | Sí (AppIntentConfiguration en Swift) |
| Live Activities | Sí (`createLiveActivity`) | Sí (Swift) |
| Otros targets (Watch, Share, App Clip…) | No | Sí (40+ tipos) |
| Registro del target en EAS/Apple | El plugin registra el widget extension en EAS Build (changelog 55.0.0-alpha.6) | `targets/` + plugin; firma "teóricamente" gestionada por EAS |
| Riesgos | Restricciones del runtime del widget (ver 2.4) | Mantener Swift sin Mac; React Native + previews de SwiftUI dan problemas |

**Recomendación: `expo-widgets`.** Desarrollando desde Windows, escribir el widget en TSX y compilar en EAS es muchísimo más viable que mantener Swift sin Xcode. `@bacons/apple-targets` queda como plan B (o para un futuro target de Apple Watch).

### 2.3 Setup exacto con `expo-widgets` ✅

**1) Instalar**

```bash
npx expo install expo-widgets @expo/ui
```

**2) Configurar el plugin** (en `app.config.ts` o `app.json`; requiere nueva build nativa):

```json
[
  "expo-widgets",
  {
    "groupIdentifier": "group.com.example.triplan",
    "widgets": [
      {
        "name": "NextSession",
        "displayName": "Próxima sesión",
        "description": "Tu próximo entreno y con quién entrenas",
        "ios": {
          "supportedFamilies": [
            "systemSmall", "systemMedium",
            "accessoryCircular", "accessoryRectangular", "accessoryInline"
          ],
          "initialLayout": "./src/widgets/next-session.tsx"
        }
      },
      {
        "name": "WeekLoad",
        "displayName": "Semana",
        "description": "Carga planificada vs. completada",
        "ios": { "supportedFamilies": ["systemMedium", "systemLarge"] }
      }
    ]
  }
]
```

Opciones de nivel superior ✅: `bundleIdentifier` (por defecto `<bundleId>.ExpoWidgetsTarget`), `groupIdentifier` (por defecto `group.<bundleId>`; si no hay `ios.bundleIdentifier`, prebuild falla), `enablePushNotifications` (Live Activities por push; default `false`), `frequentUpdates` (Live Activities; default `false`), `enableAndroid` (default `false`), `widgets[]`.
Opciones por widget ✅: `name` (identificador Swift/Kotlin válido, igual al de `createWidget`), `displayName`, `description`, `ios.supportedFamilies`, `ios.contentMarginsDisabled`, `ios.initialLayout` (para que aparezca en la galería antes de abrir la app), `ios.configuration` (iOS 17+). Los `supportedFamilies`/`contentMarginsDisabled` de nivel superior están **deprecados** → usar el bloque `ios`.

Familias iOS ✅: `systemSmall`, `systemMedium`, `systemLarge`, `systemExtraLarge` (solo iPad), `accessoryCircular`, `accessoryRectangular`, `accessoryInline` (pantalla de bloqueo).

**3) Definir el widget** (adaptado del ejemplo oficial; `Image systemName` ❓ comprobar el nombre exacto de la prop en `@expo/ui`):

```tsx
// src/widgets/next-session.tsx
import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

export type NextSessionProps = {
  title: string;          // "Rodaje Z2 50'"
  sport: 'swim' | 'bike' | 'run' | 'strength' | 'rest';
  whenLabel: string;      // "Hoy 18:30"
  partner: string | null; // "con Pablo"
  url: string;            // "triplan://session/abc"
};

const NextSession = (props: NextSessionProps, environment: WidgetEnvironment) => {
  'widget';
  // Todo debe declararse DENTRO de la función (sin constantes de módulo, sin hooks, sin async)
  const symbol =
    props.sport === 'swim' ? 'figure.pool.swim'
    : props.sport === 'bike' ? 'figure.outdoor.cycle'
    : props.sport === 'run' ? 'figure.run'
    : props.sport === 'strength' ? 'dumbbell' : 'bed.double';

  if (environment.widgetFamily === 'accessoryInline') {
    return <Text modifiers={[widgetURL(props.url)]}>{`${props.whenLabel} · ${props.title}`}</Text>;
  }
  if (environment.widgetFamily === 'accessoryCircular') {
    return <Image systemName={symbol} modifiers={[widgetURL(props.url)]} />;
  }
  if (environment.widgetFamily === 'accessoryRectangular') {
    return (
      <VStack modifiers={[widgetURL(props.url)]}>
        <Text modifiers={[font({ weight: 'bold' })]}>{props.title}</Text>
        <Text>{props.whenLabel}</Text>
      </VStack>
    );
  }
  return (
    <VStack modifiers={[widgetURL(props.url)]}>
      <HStack>
        <Image systemName={symbol} />
        <Spacer />
        <Text modifiers={[foregroundStyle('secondary')]}>{props.whenLabel}</Text>
      </HStack>
      <Text modifiers={[font({ weight: 'bold' })]}>{props.title}</Text>
      {props.partner ? <Text>{props.partner}</Text> : null}
    </VStack>
  );
};

export default createWidget('NextSession', NextSession, {
  title: 'Sin sesiones planificadas',
  sport: 'rest',
  whenLabel: '—',
  partner: null,
  url: 'triplan://today',
});
```

`WidgetEnvironment` ✅: `widgetFamily`, `date`, `colorScheme`, `widgetRenderingMode` (`fullColor` | `vibrant` | `accented`), `isLuminanceReduced`, `widgetContentMargins`, `showsWidgetLabel`, `configuration`.
`widgetURL(url: string)` ✅: un único `widgetURL` por jerarquía (si hay varios, comportamiento indefinido). Otros modificadores de widgets en `@expo/ui`: `widgetAccentedRenderingMode(...)`, `activityBackgroundTint(color)`.

**4) Actualizar desde la app** ✅ — la API es de **props**, no hay almacenamiento clave/valor:

```ts
// src/services/widgets/sync-widgets.ts
import { Platform } from 'react-native';
import NextSession, { type NextSessionProps } from '@/widgets/next-session';
import type { PlannedSession } from '@/domain/types';
import { toNextSessionProps } from './mappers';

/** Programa una entrada de timeline por cada sesión: al terminar una, el widget muestra la siguiente
 *  aunque la app no se abra. */
export function syncNextSessionWidget(sessions: readonly PlannedSession[], now = new Date()): void {
  if (Platform.OS !== 'ios') return;
  const upcoming = [...sessions]
    .filter((s) => s.endsAt > now)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, 30);

  const entries: { date: Date; props: NextSessionProps }[] = [
    { date: now, props: toNextSessionProps(upcoming[0]) },
    ...upcoming.map((s, i) => ({ date: s.endsAt, props: toNextSessionProps(upcoming[i + 1]) })),
  ];
  NextSession.updateTimeline(entries);
}
```

Métodos del objeto devuelto por `createWidget` ✅: `updateSnapshot(props)` (inmediato; iOS+Android), `updateTimeline(entries)` (iOS), `getTimeline()` (iOS), `reload()`. Además: `widgetsDirectory` (URL `file://` compartida para imágenes; `null` si no hay App Group), `addUserInteractionListener(listener)`, `setConfigurationParameterEnum(name, options)`.

**Cuándo llamar a `syncNextSessionWidget`**: tras cargar/cambiar el plan (Supabase Realtime o al volver a primer plano), tras aceptar un replanteo del Coach y tras marcar una sesión como hecha.

**5) Widget interactivo (iOS 17+)** ✅: un `Button` cuyo `onPress` devuelve nuevas props se persiste y recarga **sin proceso de la app**; `addUserInteractionListener` solo dispara si la app está viva → usarlo para sincronizar (p. ej., "✔ Hecho" en el widget y luego subir a Supabase al abrir la app).

### 2.4 Limitaciones y presupuesto de refresco

- Runtime aislado ✅: solo componentes/modificadores de `@expo/ui/swift-ui`; **sin** componentes RN (`View`, `Text` de RN), hooks, estado, contexto, async ni referencias a nada declarado fuera de la función (error "Can't find variable"). Los datos llegan solo por props y `environment`.
- Rendering tintado (`accented`) requiere iOS 18+; interactivos/configurables iOS 17+; Live Activities push-to-start iOS 17.2+.
- WidgetKit decide cuándo refrescar: no pedir `reload()` en cada cambio, agrupar (presupuesto diario limitado). Las entradas de timeline sí se respetan por fecha. ⚠️
- ❓ No está documentado si EAS Update (OTA) actualiza el bundle JS del widget → asumir que **cambiar el layout del widget requiere nueva build**.
- Si el widget no aparece en la galería tras instalar: abrir la app una vez o usar `ios.initialLayout`.

### 2.5 Plan B: `@bacons/apple-targets@5.0.0` ✅

```bash
npx create-target widget          # crea targets/widget/, instala el paquete y añade el plugin
npx expo prebuild -p ios --clean  # (en local solo útil con Mac; en Windows lo hace EAS Build)
```

Requisitos declarados en el README: CocoaPods 1.16.2+, Xcode 16+, Expo SDK 53+ (no menciona Xcode 26/27; EAS usa 27.1). `deploymentTarget` por defecto del target: 18.0.

`app.json`:

```json
{
  "expo": {
    "ios": {
      "bundleIdentifier": "com.example.triplan",
      "entitlements": { "com.apple.security.application-groups": ["group.com.example.triplan"] }
    },
    "plugins": ["@bacons/apple-targets"]
  }
}
```

`targets/widget/expo-target.config.js` (CommonJS obligatorio, sin TS/ESM):

```js
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'widget',
  colors: { $accent: '#FF5A1F', $widgetBackground: '#0B0F14' },
  entitlements: {
    'com.apple.security.application-groups':
      config.ios.entitlements['com.apple.security.application-groups'],
  },
});
```

Datos desde RN:

```ts
import { ExtensionStorage } from '@bacons/apple-targets';
const storage = new ExtensionStorage('group.com.example.triplan');
storage.set('nextSession', JSON.stringify(payload)); // string | number | objetos/arrays
ExtensionStorage.reloadWidget();                       // o reloadWidget('NombreWidget')
```

Swift (en `targets/widget/*.swift`): leer con `UserDefaults(suiteName: "group.com.example.triplan")?.string(forKey: "nextSession")`, timeline con `policy: .after(fecha)` (cada 30–60 min como máximo razonable) y `.widgetURL(URL(string: "triplan://today"))`. Si el ID del grupo no coincide exactamente en app, target y suite, todas las lecturas devuelven `nil` sin aviso.

---

## 3. HealthKit con `@kingstinct/react-native-healthkit@16.2.0`

### 3.1 Instalación y requisitos ✅

```bash
npx expo install @kingstinct/react-native-healthkit react-native-nitro-modules
```

- `peerDependencies`: `react >=19`, `react-native >=0.79`, **`react-native-nitro-modules >=0.35`** (última: 0.37.1). Dependencia directa: `@react-native-healthkit/core@16.2.0` (Expo lo autolinkea; en bare RN hay que añadirlo al `package.json`).
- Construido sobre **Nitro Modules** desde la v9 (New Architecture, ya obligatoria). No funciona en Expo Go.
- v16.0.0 (18-sep-2026): los tres paquetes (`@kingstinct/react-native-healthkit`, `@react-native-healthkit/core`, `@react-native-healthkit/health-records`) comparten versión → **actualizarlos juntos**; `deserializeHKQueryAnchor` lanza si el anchor base64 es inválido; nuevo tipo iOS 27 `HKQuantityTypeIdentifierHeartRateVariabilityRMSSD`; `getEarliestAuthorizedSampleDates`.
- v16.1.0 (7-oct): arreglo de builds con static frameworks. v16.2.0 (12-oct): `queryActivitySummary`; `requestAuthorization`/`getRequestStatusForAuthorization` ya no crashean con `EXC_BREAKPOINT` ante excepciones de HealthKit.

### 3.2 Plugin de Expo ✅

```json
[
  "@kingstinct/react-native-healthkit",
  {
    "NSHealthShareUsageDescription": "TriPlan lee tus entrenos, frecuencia cardiaca, VFC y sueño (sincronizados desde Garmin Connect) para ajustar tu plan semanal.",
    "NSHealthUpdateUsageDescription": false,
    "background": true
  }
]
```

Tipo real de opciones: `NSHealthShareUsageDescription?: string | true`, `NSHealthUpdateUsageDescription?: string | false` (`false` = no se escribe la clave; somos solo lectura), `background?: boolean`.
Lo que hace el plugin (core): entitlement `com.apple.developer.healthkit: true`; `com.apple.developer.healthkit.background-delivery: true` **salvo** `background: false`; `com.apple.developer.healthkit.access` solo si se pasa `access`; texto por defecto "`<appName>` wants to read your health data" (cambiarlo: App Review rechaza textos vagos). No toca `UIBackgroundModes`.

### 3.3 Permisos ✅

Firmas (CoreModule):

```ts
requestAuthorization(toRequest: AuthDataTypes): Promise<boolean>
getRequestStatusForAuthorization(toCheck: AuthDataTypes): Promise<AuthorizationRequestStatus>
authorizationStatusFor(type: ObjectTypeIdentifier): AuthorizationStatus
isHealthDataAvailable(): boolean

interface AuthDataTypes {
  toShare?: readonly SampleTypeIdentifierWriteable[];
  toRead?: readonly ObjectTypeIdentifier[];
}
```

- ⚠️ El README avisa: **consultar un tipo sin haber pedido permiso crashea la app**. Pedir permisos en un paso de onboarding ("Conectar Salud"), no en el mismo componente que monta hooks de datos.
- HealthKit **no revela si el usuario denegó la lectura** (privacidad de Apple): el `true` de `requestAuthorization` solo indica que el diálogo se procesó. Tratar "sin datos" como posible denegación y ofrecer un enlace a Ajustes > Salud.
- Hook alternativo: `useHealthkitAuthorization({ toRead: [...] })` → `[authorizationStatus, requestAuthorization]`.

### 3.4 Identificadores que necesitamos ✅

| Dato | Identificador | Unidad canónica (lib) |
|---|---|---|
| Entrenos | `HKWorkoutTypeIdentifier` (constante `WorkoutTypeIdentifier`) | — |
| Rutas GPS | `HKWorkoutRouteTypeIdentifier` | — |
| FC | `HKQuantityTypeIdentifierHeartRate` | `count/s` (pedir `unit: 'count/min'`) |
| FC en reposo | `HKQuantityTypeIdentifierRestingHeartRate` | `count/min` |
| VFC (SDNN) | `HKQuantityTypeIdentifierHeartRateVariabilitySDNN` | `ms` |
| VFC (RMSSD, iOS 27) | `HKQuantityTypeIdentifierHeartRateVariabilityRMSSD` | `ms` |
| VO2max | `HKQuantityTypeIdentifierVO2Max` | `ml/(kg*min)` |
| Sueño | `HKCategoryTypeIdentifierSleepAnalysis` | categoría |
| Energía activa | `HKQuantityTypeIdentifierActiveEnergyBurned` | |
| Distancias | `HKQuantityTypeIdentifierDistanceWalkingRunning`, `…DistanceCycling`, `…DistanceSwimming` | |

`CategoryValueSleepAnalysis` ✅: `inBed = 0`, `asleepUnspecified = 1` (alias `asleep = 1`), `awake = 2`, `asleepCore = 3`, `asleepDeep = 4`, `asleepREM = 5`.
`WorkoutActivityType` (selección) ✅: `running = 37`, `cycling = 13`, `swimming = 46`, `swimBikeRun = 82`, `transition = 83`, `traditionalStrengthTraining = 50`, `functionalStrengthTraining = 20`, `soccer = 41`, `tennis = 48`, `paddleSports = 31` (¡es piragüismo/remo, no pádel!), `pickleball = 79`, `walking = 52`, `hiking = 24`, `yoga = 57`, `other = 3000`. **No existe "padel"** → los partidos de pádel de Garmin probablemente lleguen como `other`/`tennis`/`racquetball` ❓ (verificar con datos reales).

### 3.5 Firmas de consulta (v16) ✅

```ts
queryWorkoutSamples(options: WorkoutQueryOptions): Promise<readonly WorkoutProxyTyped[]>
queryWorkoutSamplesWithAnchor(options: WorkoutQueryOptionsWithAnchor): Promise<QueryWorkoutSamplesWithAnchorResponse>
queryQuantitySamples<T>(identifier: T, options: QueryOptionsWithSortOrderAndUnit<UnitForIdentifier<T>>): Promise<readonly QuantitySampleTyped<T>[]>
queryQuantitySamplesWithAnchor<T>(identifier: T, options: QueryOptionsWithAnchorAndUnit<…>): Promise<{ samples, deletedSamples, newAnchor }>
queryCategorySamples<T>(identifier: T, options: QueryOptionsWithSortOrder): Promise<readonly CategorySampleTyped<T>[]>
queryStatisticsForQuantity<T>(identifier: T, statistics: readonly StatisticsOptions[], options?: StatisticsQueryOptions): Promise<QueryStatisticsResponse>
queryStatisticsCollectionForQuantity<T>(identifier: T, statistics: readonly StatisticsOptions[], anchorDate: Date,
  intervalComponents: IntervalComponents, options?: StatisticsQueryOptions): Promise<readonly QueryStatisticsResponse[]>
getMostRecentQuantitySample(identifier, unit?)   // = queryQuantitySamples con limit: 1
```

Tipos de opciones ✅:
- `WorkoutQueryOptions = { filter?: FilterForWorkouts; limit: number; ascending?: boolean }` (`…WithAnchor` cambia `ascending` por `anchor?: string`).
- `GenericQueryOptions`: `limit` **obligatorio**; `-1`, `0` o cualquier no positivo = todos. `filter?: FilterForSamples` con `uuid`, `uuids`, `metadata`, `date`, `workout`, `sources` y combinadores `AND`/`OR`/`NOT`.
- `DateFilter = { startDate?: Date; endDate?: Date; strictStartDate?: boolean; strictEndDate?: boolean }`.
- `FilterForWorkouts` añade `workoutActivityType?` y `duration?: { predicateOperator, durationInSeconds }`.
- `StatisticsOptions = 'cumulativeSum' | 'discreteAverage' | 'discreteMax' | 'discreteMin' | 'duration' | 'mostRecent'`.
- `IntervalComponents = { minute?, hour?, day?, month?, year? }`.
- `QueryStatisticsResponse`: `averageQuantity`, `maximumQuantity`, `minimumQuantity`, `sumQuantity`, `mostRecentQuantity`, `duration`, `startDate`, `endDate`, `sources`.
- `WorkoutProxy`: `toJSON()`, `getStatistic(quantityType, unitOverride?)`, `getAllStatistics()`, `getWorkoutRoutes()`, `getWorkoutPlan()`; liberar con `dispose()` (usar `toJSON()` antes si se quieren conservar los datos).

### 3.6 Código de ejemplo para la app (propio, basado en las firmas anteriores)

```ts
// src/services/health/health.ios.ts
import {
  isHealthDataAvailable, requestAuthorization, queryWorkoutSamples, queryQuantitySamples,
  queryCategorySamples, queryStatisticsCollectionForQuantity, getMostRecentQuantitySample,
  CategoryValueSleepAnalysis,
} from '@kingstinct/react-native-healthkit';

const READ_TYPES = [
  'HKWorkoutTypeIdentifier',
  'HKQuantityTypeIdentifierHeartRate',
  'HKQuantityTypeIdentifierRestingHeartRate',
  'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
  'HKQuantityTypeIdentifierVO2Max',
  'HKCategoryTypeIdentifierSleepAnalysis',
  'HKQuantityTypeIdentifierActiveEnergyBurned',
] as const;

const DAY_MS = 86_400_000;

export async function connectHealth(): Promise<boolean> {
  if (!isHealthDataAvailable()) return false;
  return requestAuthorization({ toRead: READ_TYPES });
}

export async function getRecentWorkouts(days = 14) {
  const workouts = await queryWorkoutSamples({
    limit: 0,
    ascending: false,
    filter: { date: { startDate: new Date(Date.now() - days * DAY_MS), endDate: new Date() } },
  });
  try {
    return await Promise.all(workouts.map(async (w) => {
      const json = w.toJSON();
      const hr = await w.getStatistic('HKQuantityTypeIdentifierHeartRate', 'count/min');
      return {
        uuid: json.uuid, type: json.workoutActivityType,
        start: json.startDate, end: json.endDate,
        durationSec: json.duration.quantity, // Quantity {quantity, unit}
        distance: json.totalDistance, energy: json.totalEnergyBurned,
        avgHr: hr?.averageQuantity?.quantity ?? null,
        maxHr: hr?.maximumQuantity?.quantity ?? null,
      };
    }));
  } finally {
    workouts.forEach((w) => w.dispose());
  }
}

export async function getReadiness() {
  const since = new Date(Date.now() - 7 * DAY_MS);
  const [hrv, rhr, vo2] = await Promise.all([
    queryQuantitySamples('HKQuantityTypeIdentifierHeartRateVariabilitySDNN', {
      limit: 0, ascending: true, unit: 'ms', filter: { date: { startDate: since } },
    }),
    getMostRecentQuantitySample('HKQuantityTypeIdentifierRestingHeartRate'),
    getMostRecentQuantitySample('HKQuantityTypeIdentifierVO2Max'),
  ]);
  return { hrvSeries: hrv.map((s) => ({ at: s.startDate, ms: s.quantity })), restingHr: rhr?.quantity, vo2max: vo2?.quantity };
}

export async function getSleepLastNight() {
  const samples = await queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis', {
    limit: 0, ascending: true, filter: { date: { startDate: new Date(Date.now() - DAY_MS) } },
  });
  const asleep = samples.filter((s) => s.value !== CategoryValueSleepAnalysis.inBed && s.value !== CategoryValueSleepAnalysis.awake);
  const minutes = asleep.reduce((acc, s) => acc + (s.endDate.getTime() - s.startDate.getTime()) / 60_000, 0);
  return { minutesAsleep: Math.round(minutes) };
}

export async function getDailyRestingHr(days = 28) {
  const anchor = new Date(); anchor.setHours(0, 0, 0, 0);
  return queryStatisticsCollectionForQuantity(
    'HKQuantityTypeIdentifierRestingHeartRate', ['discreteAverage'], anchor, { day: 1 },
    { filter: { date: { startDate: new Date(Date.now() - days * DAY_MS) } } },
  );
}
```

❓ Detalles a confirmar compilando: forma exacta de `json.duration` (es `Quantity`), si `CategoryValueSleepAnalysis` se exporta desde la raíz (sí está en `healthkit.generated.ts` y se re-exporta desde `types`), y que los samples con varias fuentes (iPhone + Garmin) no dupliquen el sueño (filtrar por `sourceRevision`/fuente Garmin).

### 3.7 Sincronización incremental y en segundo plano ✅

- **Anchors**: `queryWorkoutSamplesWithAnchor` / `queryQuantitySamplesWithAnchor` devuelven `{ samples, deletedSamples, newAnchor }`; guardar `newAnchor` (p. ej. en `expo-sqlite`) y pasarlo como `anchor` la próxima vez → solo cambios. Desde v16 un anchor corrupto **lanza** (capturar y reiniciar sin anchor).
- **Background delivery**:

```ts
import { configureBackgroundTypes, subscribeToChanges, UpdateFrequency } from '@kingstinct/react-native-healthkit';

// Una vez tras obtener permisos: el pod registra los observers en didFinishLaunching (sobrevive a cierres).
await configureBackgroundTypes(['HKWorkoutTypeIdentifier', 'HKCategoryTypeIdentifierSleepAnalysis'], UpdateFrequency.immediate);

// En JS (app viva o despertada): sincronizar con anchor y subir a Supabase.
const sub = subscribeToChanges('HKWorkoutTypeIdentifier', () => { void syncWorkoutsWithAnchor(); });
// sub.remove()
```

Firmas: `enableBackgroundDelivery(typeIdentifier, updateFrequency): Promise<boolean>`, `configureBackgroundTypes(typeIdentifiers: string[], updateFrequency): Promise<boolean>`, `clearBackgroundTypes()`, `disableBackgroundDelivery(type)`; `UpdateFrequency { immediate = 1, hourly = 2, daily = 3, weekly = 4 }`. iOS sigue decidiendo cuándo despierta la app (no garantizado; `.immediate` en la práctica es "pronto").

### 3.8 Garmin → Apple Salud: qué llega realmente ⚠️

- Garmin Connect escribe en Apple Salud (según listados de soporte reproducidos por terceros): **entrenos** (sin la traza GPS), **FC**, energía activa/en reposo, **sueño** (fases desde Garmin Connect 4.71+), pasos, distancias, peso.
- **No parece enviar VFC (HRV), VO2max, SpO2 ni respiración** (Teambuildr y apps "bridge" como Vitals Sync lo indican; no hay confirmación oficial de Garmin). FC en reposo: sin confirmar.
- Consecuencia de diseño: HealthKit es **una fuente cómoda y gratuita para entrenos/FC/sueño**, pero las métricas clave del coach (HRV status, Training Readiness, Body Battery, VO2max, carga) hay que tomarlas de Garmin por otra vía (ver `04-integracion-garmin.md`) o desde el propio Claude del usuario (que ya tiene el conector de Garmin).
- Si el usuario también lleva Apple Watch o usa apps que escriben HRV, HealthKit sí la tendrá.

### 3.9 App Review y privacidad ✅

- Guideline **5.1.3(i)**: datos de HealthKit no pueden usarse para publicidad/data mining; solo para mejorar la gestión de la salud del usuario y con permiso; hay que **informar de qué datos de salud se recogen**.
- **5.1.3(ii)**: no guardar información personal de salud en **iCloud** (Supabase sí está permitido, con consentimiento).
- **5.1.1(i)**: política de privacidad enlazada en App Store Connect y dentro de la app.
- **2.5.1**: HealthKit solo para salud/fitness y mencionar la integración en la descripción.
- Compartir con el amigo: compartir **solo derivados** (sesión planificada/completada, disponibilidad), con opt-in explícito; nunca series crudas de FC/HRV por defecto.

---

## 4. Notificaciones (`expo-notifications@58.1.6`)

### 4.1 Instalación y plugin ✅

```bash
npx expo install expo-notifications expo-device expo-constants
```

```json
["expo-notifications", { "sounds": [], "enableBackgroundRemoteNotifications": false }]
```

Opciones del plugin: `icon`, `largeIcon`, `color` (Android), `sounds` (array de ficheros locales, `.wav` recomendado), `enableBackgroundRemoteNotifications` (iOS, añade `remote-notification` a `UIBackgroundModes`; default `false`). El entitlement `aps-environment` lo gestiona el plugin + EAS.

### 4.2 Handler (presentación en primer plano) ✅

En **SDK 58 las notificaciones en primer plano se muestran por defecto** (banner, lista, sonido, badge) mientras no haya handler o si no responde en 3 s. Para controlar:

```ts
import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});
```

(`shouldShowAlert` está deprecado.)

### 4.3 Permisos iOS ✅

```ts
const { status } = await Notifications.requestPermissionsAsync({
  ios: { allowAlert: true, allowBadge: true, allowSound: true },
});
```

Claves iOS disponibles: `allowAlert`, `allowBadge`, `allowSound`, `allowProvisional` (¡no `provisional`!), `allowCriticalAlerts`, `allowDisplayInCarPlay`, `provideAppNotificationSettings`. Pedir permiso tras un "por qué" contextual (p. ej. al activar recordatorios del plan).

### 4.4 Notificaciones locales programadas ✅

`SchedulableTriggerInputTypes`: `CALENDAR = "calendar"`, `DAILY = "daily"`, `DATE = "date"`, `MONTHLY = "monthly"`, `TIME_INTERVAL = "timeInterval"`, `WEEKLY = "weekly"`, `YEARLY = "yearly"`.

| Trigger | Campos | Uso en la app |
|---|---|---|
| `DATE` | `date` (Date \| number) | "Tu rodaje empieza en 30 min" |
| `TIME_INTERVAL` | `seconds`, `repeats` | Pruebas, "posponer 10 min" |
| `DAILY` | `hour`, `minute` | "¿Cómo has dormido? Registra fatiga" a las 8:00 |
| `WEEKLY` | `weekday` (**1 = domingo … 7 = sábado**), `hour`, `minute` | "Domingo 20:00: revisa la semana con tu Coach" |
| `MONTHLY` | `day`, `hour`, `minute` | — |
| `CALENDAR` (solo iOS) | `year`, `month`, `day`, `weekday`, `hour`, `minute`, `second`, `weekOfMonth`, `weekOfYear`, `weekdayOrdinal`, `timezone`, `repeats` | Alternativa iOS a DATE/WEEKLY |

```ts
export async function scheduleSessionReminder(s: { id: string; title: string; startsAt: Date }) {
  const fireAt = new Date(s.startsAt.getTime() - 30 * 60_000);
  if (fireAt.getTime() <= Date.now()) return null;
  return Notifications.scheduleNotificationAsync({
    identifier: `session-${s.id}`,        // permite reemplazar/cancelar de forma idempotente
    content: {
      title: 'En 30 min: ' + s.title,
      body: 'Toca para ver la sesión',
      data: { url: `/session/${s.id}` },  // lo usa useNotificationObserver (1.5.5)
      categoryIdentifier: 'session',
      threadIdentifier: 'sessions',       // agrupa en el centro de notificaciones
      interruptionLevel: 'active',
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt },
  });
}

await Notifications.scheduleNotificationAsync({
  content: { title: 'Revisión semanal', body: 'Planifica la semana con tu Coach', data: { url: '/coach' } },
  trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: 1, hour: 20, minute: 0 },
});
```

Gestión: `getAllScheduledNotificationsAsync()`, `cancelScheduledNotificationAsync(id)`, `cancelAllScheduledNotificationsAsync()`.

`NotificationContentInput` ✅: `title`, `subtitle`, `body`, `data` (no se muestra), `badge`, `sound` (`false` | `'default'` | `'defaultCritical'` | …), `categoryIdentifier` (iOS), `threadIdentifier`, `interruptionLevel` (`'passive' | 'active' | 'timeSensitive' | 'critical'`), `attachments` (iOS).
⚠️ `timeSensitive` requiere el entitlement `com.apple.developer.usernotifications.time-sensitive` y `critical` un entitlement especial de Apple → no usar en el MVP.

### 4.5 Límite de 64 notificaciones locales pendientes (iOS) ✅

Apple (DTS en foros): **máximo 64 solicitudes pendientes por app**; el sistema conserva las 64 más próximas y descarta el resto; una notificación repetitiva cuenta como una. Estrategia:

1. Programar solo una **ventana móvil** (p. ej. próximos 7 días ≈ 2 por día = 14 + 3 repetitivas).
2. Reprogramar (cancelar por identificador + volver a crear) al: abrir la app, cambiar el plan, recibir un cambio por Realtime y en una tarea `expo-background-task` (mínimo 15 min, sin garantía; no funciona en simulador).
3. Nunca usar `cancelAllScheduledNotificationsAsync()` a la ligera: borra también las repetitivas.
4. Avisos sociales ("Pablo se ha unido a tu tirada") → **push remoto**, no locales.

### 4.6 Categorías y acciones ✅

```ts
await Notifications.setNotificationCategoryAsync('session', [
  { identifier: 'done', buttonTitle: '✔ Hecho', options: { opensAppToForeground: false } },
  { identifier: 'move', buttonTitle: 'Mover a mañana', options: { opensAppToForeground: true } },
  { identifier: 'skip', buttonTitle: 'Saltar', options: { isDestructive: true } },
]);
```

- Firma: `setNotificationCategoryAsync(identifier, actions, options?)`; `actions[]` = `{ identifier, buttonTitle, options?: { isAuthenticationRequired, isDestructive, opensAppToForeground }, textInput?: { placeholder, submitButtonTitle } }`; `options` de categoría: `previewPlaceholder`, `showTitle`, `showSubtitle`, `customDismissAction`, `allowInCarPlay`.
- **No usar `:` ni `-` en el identificador de categoría.**
- La acción llega en `addNotificationResponseReceivedListener` (`response.actionIdentifier`). Con `opensAppToForeground: false` el JS puede no estar vivo ❓ → para "Hecho" sin abrir la app, encolar y sincronizar al volver.

### 4.7 Push: token y almacenamiento ✅

```ts
import Constants from 'expo-constants';
import * as Device from 'expo-device';

export async function registerForPush(): Promise<string | null> {
  if (!Device.isDevice) return null;
  const { status } = await Notifications.getPermissionsAsync();
  const finalStatus = status === 'granted' ? status : (await Notifications.requestPermissionsAsync()).status;
  if (finalStatus !== 'granted') return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error('Falta extra.eas.projectId (ejecuta eas init)');
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  return data; // "ExponentPushToken[...]" → upsert en la tabla push_tokens de Supabase
}
```

- `projectId` se establece al hacer `eas init`; la doc recomienda fijarlo explícitamente.
- La clave APNs la genera EAS en el primer `eas build` (responder "sí" a *Setup Push Notifications* / *Generating a new Apple Push Notifications service key*); o con `eas credentials`.

### 4.8 Envío vía Expo Push API (desde Supabase Edge Function) ✅

- `POST https://exp.host/--/api/v2/push/send` con `Content-Type: application/json`, `Accept: application/json`, `Accept-Encoding: gzip, deflate`; con *Enhanced push security* activada en el dashboard de EAS añadir `Authorization: Bearer <EXPO_ACCESS_TOKEN>` (sin él → `UNAUTHORIZED`). **Activarlo**: sin token, cualquiera con un push token podría enviarnos notificaciones.
- Cuerpo: un mensaje o array de **hasta 100**. Campos: `to` (obligatorio), `title`, `body`, `data` (≤ ~4 KiB total), `sound`, `badge`, `categoryId`, `mutableContent`, `interruptionLevel`, `ttl`, `priority`, `channelId` (Android).
- Respuesta: *tickets* (`status: "ok"` + `id` ≠ entregado). Receipts: `POST https://exp.host/--/api/v2/push/getReceipts` con `{ "ids": [...] }` (≤ 1000), consultar ~15 min después; se borran a las 24 h.
- Errores: `DeviceNotRegistered` (borrar token), `MessageRateExceeded` (backoff exponencial), `MessageTooBig`, `TOO_MANY_REQUESTS`. Límite: **600 notificaciones/s por proyecto**.

```ts
// supabase/functions/push/index.ts  (esquema; Supabase documenta también la variante con @supabase/server)
Deno.serve(async (req) => {
  const { tokens, title, body, url } = await req.json();
  const messages = tokens.map((to: string) => ({ to, title, body, data: { url }, sound: 'default' }));
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${Deno.env.get('EXPO_ACCESS_TOKEN')}`,
    },
    body: JSON.stringify(messages),
  });
  return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json' } });
});
```

Disparadores típicos: Database Webhook en `INSERT` de `notifications` / `session_invites` → Edge Function `push`. Secretos: `supabase secrets set --env-file .env.local` (con `EXPO_ACCESS_TOKEN`). Autorizar la llamada dentro de la función (no basta con `verify_jwt`).

---

## 5. Calendario (`expo-calendar@58.0.6`)

### 5.1 API nueva por defecto ✅

- En SDK 55 apareció como `expo-calendar/next`; en SDK 56 se estabilizó; en **SDK 58 la API orientada a objetos es la exportación por defecto** y las funciones `*Async` antiguas **lanzan excepción en runtime** salvo que se importen desde `expo-calendar/legacy`.

| Deprecado | Reemplazo |
|---|---|
| `getCalendarsAsync` | `getCalendars()` |
| `getCalendarPermissionsAsync` / `requestCalendarPermissionsAsync` | `getCalendarPermissions()` / `requestCalendarPermissions()` |
| `createCalendarAsync` | `createCalendar()` |
| `createEventAsync` | `calendar.createEvent()` |
| `createEventInCalendarAsync` | `calendar.addEventWithForm()` |
| `getDefaultCalendarAsync` | `getDefaultCalendarSync()` (solo iOS) |
| `getEventAsync` | `calendar.listEvents()` |
| `openEventInCalendarAsync` / `editEventInCalendarAsync` | `event.openInCalendar()` / `event.editInCalendar()` |

### 5.2 Plugin y permisos ✅

```json
["expo-calendar", { "calendarPermission": "TriPlan lee tus clases y compromisos para encajar los entrenos y puede añadir tus sesiones a tu calendario." }]
```

- `calendarPermission` → `NSCalendarsUsageDescription` + `NSCalendarsFullAccessUsageDescription`.
- `writeOnlyAccess: true` + `writeOnlyCalendarPermission` → solo escritura (iOS 17+): **no sirve**, necesitamos leer la semana (con write-only, `getCalendars` devuelve un único calendario virtual y `listEvents` no funciona).
- `remindersPermission` solo si se usan Recordatorios (no en el MVP).

### 5.3 Leer eventos de todos los calendarios en un rango ✅

```ts
import * as Calendar from 'expo-calendar';

export async function readBusyBlocks(from: Date, to: Date) {
  const { status } = await Calendar.requestCalendarPermissions(); // Promise<PermissionResponse>
  if (status !== 'granted') return [];
  const calendars = Calendar.getCalendars(Calendar.EntityTypes.EVENT); // ExpoCalendar[]
  const events = await Calendar.listEvents(calendars, from, to);       // (string | ExpoCalendar)[]
  return events.map((e) => ({
    id: e.id, calendarId: e.calendarId, title: e.title,
    start: new Date(e.startDate), end: new Date(e.endDate),
    allDay: e.allDay, availability: e.availability,
  }));
}
```

- Firmas: `Calendar.listEvents(calendars: (string | ExpoCalendar)[], startDate: Date, endDate: Date): Promise<ExpoCalendarEvent[]>`; `ExpoCalendar.listEvents(startDate, endDate)` para uno solo.
- `ExpoCalendarEvent`: `id`, `title`, `startDate`/`endDate` (`string | Date` → normalizar), `allDay`, `availability`, `calendarId`, `location`, `notes`, `timeZone`, `alarms`…
- Los calendarios de Google/Outlook/la universidad aparecen si están añadidos como cuentas en iOS (Ajustes > Calendario > Cuentas) o suscritos (ICS).
- Privacidad: subir a Supabase **solo bloques ocupado/libre** (inicio, fin, `availability`, quizá categoría) y nunca títulos/notas salvo opt-in; el título solo se usa en local para el contexto del Coach si el usuario lo permite.

### 5.4 Escribir las sesiones en un calendario propio ✅/❓

```ts
export async function ensureTrainingCalendar(): Promise<Calendar.ExpoCalendar> {
  const existing = Calendar.getCalendars(Calendar.EntityTypes.EVENT).find((c) => c.title === 'TriPlan');
  if (existing) return existing;
  return Calendar.createCalendar({ title: 'TriPlan', color: '#FF5A1F', entityType: Calendar.EntityTypes.EVENT });
}

export async function pushSessionToCalendar(cal: Calendar.ExpoCalendar, s: { title: string; startsAt: Date; endsAt: Date; notes?: string }) {
  return cal.createEvent({ title: s.title, startDate: s.startsAt, endDate: s.endsAt, notes: s.notes, alarms: [{ relativeOffset: -30 }] });
}
```

- `createCalendar(details?: Partial<Calendar>)` → `Promise<ExpoCalendar>`; `createEvent(details: Partial<…Event>)` → `Promise<ExpoCalendarEvent>`.
- ❓ En iOS, crear un calendario puede requerir indicar `sourceId` (fuente local/iCloud) en algunos dispositivos; la doc v58 no lo marca obligatorio. Probar en dispositivo; fallback: `getDefaultCalendarSync()`.
- Guardar el `event.id` en Supabase junto a la sesión para poder actualizar/borrar cuando el Coach replanifique.
- Alternativa sin permisos de lectura: `calendar.addEventWithForm()` (UI del sistema).

---

## 6. Supabase en React Native (2026)

### 6.1 Claves API ✅

| Clave | Formato | Dónde | Notas |
|---|---|---|---|
| **Publishable** | `sb_publishable_…` | App (pública) | Rol de bajo privilegio; **RLS aplica** |
| **Secret** | `sb_secret_…` | Solo backend / Edge Functions | Rol `service_role` (`BYPASSRLS`); si llega con User-Agent de navegador → 401 |
| `anon` / `service_role` (legacy JWT) | JWT | — | **Se deprecan a finales de 2026**; siguen valiendo hasta desactivarlas |

- Las nuevas claves **no son JWT**: van en la cabecera `apikey`, no en `Authorization: Bearer`.
- En Edge Functions: preferir `@supabase/server` con `withSupabase({ auth: 'secret' })` (`ctx.supabaseAdmin`) o leer `SUPABASE_SECRET_KEYS` (diccionario JSON inyectado). `SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` contienen las legacy. Ver `05-claude-mcp-supabase.md`.

### 6.2 Cliente recomendado ✅ (doc de Expo "Using Supabase")

```bash
npx expo install @supabase/supabase-js expo-sqlite
# atajo: eas integrations:supabase:connect   (crea/enlaza proyecto, instala deps y escribe
#        EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY en .env.local y en EAS env)
```

Añadir `"expo-sqlite"` a `plugins`. Cliente:

```ts
// src/lib/supabase.ts
import 'expo-sqlite/localStorage/install';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import type { Database } from './database.types';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export const supabase = createClient<Database>(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: localStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // en iOS/Android no hay URL de la que leer la sesión
  },
});

// Registrar UNA vez: el refresco solo corre con la app en primer plano
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
```

- Expo ya instala un `URL` global → **no hace falta** `react-native-url-polyfill/auto` (el quickstart de Supabase aún lo importa; inocuo).
- El almacenamiento anterior típico era AsyncStorage; la doc actual de Expo/Supabase usa `expo-sqlite/localStorage`. Para mayor seguridad podría cifrarse (patrón "LargeSecureStore" con `expo-secure-store`), no necesario en el MVP.
- "Ambos valores son públicos": nunca la contraseña de BD ni la secret key en la app → **RLS en todas las tablas**.
- Desarrollo local opcional: `npx supabase init && npx supabase start` (requiere Docker).

### 6.3 Login con código por email (OTP) ✅

```ts
await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
// El usuario introduce el código de 6 dígitos en la app:
const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
```

- En el dashboard: Auth > Email Templates > **Magic Link** → incluir `{{ .Token }}` (p. ej. "Tu código: {{ .Token }}") para enviar código en lugar de enlace (evita deep links).
- Por defecto: 1 OTP cada **60 s** por usuario y caducidad **1 h**.
- ⚠️/❓ El SMTP por defecto de Supabase está muy limitado (pensado para pruebas; históricamente solo envía a miembros del equipo y con cuota baja) → configurar **SMTP propio** (Resend, Postmark…) antes de invitar a amigos.

### 6.4 Sign in with Apple nativo ✅/⚠️

Config:

```json
{ "ios": { "usesAppleSignIn": true }, "plugins": ["expo-apple-authentication"] }
```

```bash
npx expo install expo-apple-authentication expo-crypto
```

Código (patrón nonce: **hash SHA-256 a Apple, nonce crudo a Supabase**):

```ts
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { supabase } from '@/lib/supabase';

export async function signInWithApple() {
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
    nonce: hashedNonce,
  });
  if (!credential.identityToken) throw new Error('Apple no devolvió identityToken');
  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: rawNonce,
  });
  if (error) throw error;
  // Apple solo da el nombre la PRIMERA vez: guardarlo
  if (credential.fullName?.givenName) {
    await supabase.auth.updateUser({
      data: {
        full_name: [credential.fullName.givenName, credential.fullName.familyName].filter(Boolean).join(' '),
        given_name: credential.fullName.givenName,
        family_name: credential.fullName.familyName,
      },
    });
  }
}
```

- Renderizar `AppleAuthentication.AppleAuthenticationButton` solo si `isAvailableAsync()` es `true`; necesita `width`/`height` explícitos.
- Dashboard de Supabase > Auth > Providers > Apple: añadir el **bundle ID** en *Client IDs* (también el de la variante dev si existe). Para solo-nativo **no hace falta** configurar OAuth (Services ID/secret ni su rotación cada 6 meses).
- ⚠️ La guía de Expo de Supabase no usa nonce; el patrón hash→Apple / crudo→Supabase es el de las SDK de Swift/Dart/Flutter (Supabase hashea el nonce recibido y lo compara con el claim). Error típico si no coincide: `Bad ID token` (400).
- EAS sincroniza la capability Sign in with Apple automáticamente (`com.apple.developer.applesignin`).
- Guideline 4.8: si en el futuro se añade Google/Facebook login, Sign in with Apple (u opción equivalente) es obligatorio; con OTP por email + Apple vamos sobrados.

---

## 7. EAS desde Windows: build, credenciales, TestFlight, OTA

### 7.1 Visión general

Windows (Expo CLI + EAS CLI) → `eas build -p ios` (macOS en la nube, Xcode 27.1, firma con credenciales de EAS) → `eas submit` / `--auto-submit` → App Store Connect → TestFlight (tú + compañero) → iPhones; y `eas update` para OTA de JS/assets sin nueva build. EAS Submit funciona en Windows/Linux/macOS ✅. Lo único que exigiría Mac es subir con Xcode a mano o usar el simulador.

### 7.2 Primeros pasos ✅

```bash
npm install --global eas-cli      # o: npx eas-cli@latest <comando>
eas login
eas whoami
eas init                          # crea el proyecto en expo.dev y escribe extra.eas.projectId
eas build:configure               # genera eas.json
eas device:create                 # registrar los 2 iPhones (URL/QR) para builds internas
eas build -p ios --profile development
```

En el primer `eas build -p ios` la CLI pregunta si iniciar sesión en la cuenta de Apple → **sí** (Apple ID + 2FA, funciona desde Windows). EAS genera/reutiliza certificado de distribución, perfiles de aprovisionamiento (uno por target: app + widget extension) y la clave APNs.

### 7.3 `eas.json` recomendado

```json
{
  "cli": { "version": ">= 25.3.0", "appVersionSource": "remote" },
  "build": {
    "base": { "ios": { "image": "latest" } },
    "development": {
      "extends": "base",
      "developmentClient": true,
      "distribution": "internal",
      "environment": "development",
      "channel": "development"
    },
    "preview": {
      "extends": "base",
      "distribution": "internal",
      "environment": "preview",
      "channel": "preview"
    },
    "production": {
      "extends": "base",
      "autoIncrement": true,
      "environment": "production",
      "channel": "production"
    }
  },
  "submit": { "production": { "ios": { "ascAppId": "1234567890" } } }
}
```

- `distribution: "internal"` = ad hoc (dispositivos registrados, máx. 100 iPhones/año); producción = App Store/TestFlight.
- `environment` selecciona las variables de EAS (development/preview/production); `channel` enlaza la build con EAS Update.
- `ascAppId` (App Store Connect > App > Información de la app) es obligatorio en modo no interactivo. Alternativa CI: App Store Connect API Key (`eas credentials -p ios` → *App Store Connect API Key*, o `ascApiKeyPath`/`ascApiKeyIssuerId`/`ascApiKeyId`).
- `appVersionSource: "remote"` + `autoIncrement`: EAS lleva el build number (evita rechazos por número repetido).
- `resourceClass` por defecto `medium`; `large` requiere plan de pago.

### 7.4 `app.config.ts` con variables de entorno

```ts
// app.config.ts
import type { ConfigContext, ExpoConfig } from 'expo/config';

const VARIANT = process.env.APP_VARIANT ?? 'production'; // definir APP_VARIANT en EAS env por entorno
const IS_DEV = VARIANT === 'development';
const BUNDLE_ID = IS_DEV ? 'com.example.triplan.dev' : 'com.example.triplan';
const APP_GROUP = `group.${BUNDLE_ID}`;
const PROJECT_ID = '00000000-0000-0000-0000-000000000000'; // lo escribe `eas init`

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: IS_DEV ? 'TriPlan Dev' : 'TriPlan',
  slug: 'triplan',
  scheme: IS_DEV ? 'triplan-dev' : 'triplan',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/images/icon.png',
  ios: {
    bundleIdentifier: BUNDLE_ID,
    icon: './assets/expo.icon',
    supportsTablet: false,
    usesAppleSignIn: true,
    config: { usesNonExemptEncryption: false }, // evita la pregunta de cumplimiento de exportación en cada build
  },
  web: { output: 'single' },
  plugins: [
    'expo-router',
    ['expo-splash-screen', { backgroundColor: '#0B0F14', image: './assets/images/splash-icon.png', imageWidth: 76 }],
    'expo-sqlite',
    'expo-apple-authentication',
    ['expo-notifications', { enableBackgroundRemoteNotifications: false }],
    ['expo-calendar', { calendarPermission: 'TriPlan lee tus clases y compromisos para encajar los entrenos.' }],
    ['@kingstinct/react-native-healthkit', {
      NSHealthShareUsageDescription: 'TriPlan lee tus entrenos, FC y sueño para ajustar tu plan semanal.',
      NSHealthUpdateUsageDescription: false,
      background: true,
    }],
    ['expo-widgets', {
      groupIdentifier: APP_GROUP,
      widgets: [{ name: 'NextSession', displayName: 'Próxima sesión', description: 'Tu próximo entreno',
        ios: { supportedFamilies: ['systemSmall', 'systemMedium', 'accessoryRectangular', 'accessoryInline'] } }],
    }],
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
  runtimeVersion: { policy: 'fingerprint' },
  updates: { url: `https://u.expo.dev/${PROJECT_ID}` },
  extra: { eas: { projectId: PROJECT_ID } },
});
```

- Variables `EXPO_PUBLIC_*` se **incrustan en el bundle** (públicas). Nada secreto ahí.
- En Windows, para variables en línea usar `cross-env` (`npx cross-env APP_VARIANT=development npx expo start`) o `.env.local` (Expo CLI carga `.env*`).
- ⚠️ Con variantes, cada bundle ID tiene su App Group y su perfil → más credenciales. **Para el MVP basta una sola variante** (producción) usando development builds con el mismo bundle; añadir `.dev` cuando moleste.

### 7.5 Variables y secretos en EAS ✅

```bash
eas env:set --name EXPO_PUBLIC_SUPABASE_URL --value https://xxxx.supabase.co --environment production --visibility plaintext
# (comando tal cual aparece en la doc actual; versiones anteriores de la CLI usaban `eas env:create` ❓)
eas env:list --environment production
eas env:pull --environment development     # escribe .env.local para trabajar en local
```

- Visibilidad: `plaintext` (visible), `sensitive` (oculta en logs, legible por CLI), `secret` (solo en servidores EAS; para cosas como `NPM_TOKEN`, **no protege valores incrustados en la app**).
- Entornos estándar: `development`, `preview`, `production` (personalizados solo en planes Enterprise/Production).
- `eas secret:*` está sustituido por `eas env:*` ⚠️.

### 7.6 Capabilities y entitlements (HealthKit, App Groups, Apple Sign In, Push) ✅

- En cada `eas build`, EAS **sincroniza los entitlements** de la config introspeccionada (`npx expo config --type introspect`) con las capabilities del Bundle ID en Apple: activa las que faltan y **desactiva las que no estén** en los entitlements.
- Soportadas, entre otras: HealthKit (`com.apple.developer.healthkit`), Sign in with Apple (`com.apple.developer.applesignin`), Push (`aps-environment`), App Groups (`com.apple.security.application-groups`).
- **App Groups (y Merchant IDs/CloudKit) se registran automáticamente solo con autenticación por cookies de Apple** (login interactivo con Apple ID), porque la App Store Connect API no lo soporta → **hacer la primera build con widgets en modo interactivo** desde tu terminal, no en CI con API key.
- Extensiones en proyectos CNG: EAS necesita conocerlas antes de la build (`extra.eas.build.experimental.ios.appExtensions` con `targetName`, `bundleIdentifier`, `entitlements`); **`expo-widgets` registra su target con EAS automáticamente** (changelog 55.0.0-alpha.6). Comprobar en el log de la primera build que se crea el perfil de `…ExpoWidgetsTarget`.
- Depurar: `EXPO_DEBUG=1 eas build -p ios`; saltar la sincronización: `EXPO_NO_CAPABILITY_SYNC=1 eas build`. Si se activa algo a mano en el portal, **regenerar perfiles** (`eas credentials`) o fallará con "doesn't support the … capability".

### 7.7 TestFlight y testers ✅

```bash
eas build -p ios --profile production --auto-submit   # build + subida
# o por separado:
eas submit -p ios --latest
```

- Requisitos: cuenta de Apple Developer de pago (la tienes), `ios.bundleIdentifier`, app creada en App Store Connect (EAS puede crearla en el primer submit interactivo ⚠️).
- La build suele aparecer en TestFlight en **10–15 min** (tras el procesado de Apple). Caduca a los **90 días**.

| | Testers internos | Testers externos |
|---|---|---|
| Quiénes | Hasta 100 **usuarios de tu App Store Connect** con rol Account Holder, Admin, App Manager, Developer o Marketing | Hasta 10.000 personas (email o **enlace público**) |
| Revisión | No requiere Beta App Review | La 1ª build de cada versión pasa **Beta App Review** (~horas–1 día) |
| Disponibilidad | Inmediata tras procesado | Tras aprobación |

**Cómo añadir a tu compañero (recomendado: interno):**
1. App Store Connect > **Usuarios y acceso** > `+` > su Apple ID/email, rol **Developer** o **Marketing** y acceso limitado a esta app.
2. Él acepta la invitación (email).
3. App > **TestFlight** > *Internal Testing* > crear grupo (activar *automatic distribution*) > *Invite Testers* > seleccionarle.
4. Él instala **TestFlight** desde la App Store y acepta la invitación.

Para el resto de amigos (red social): grupo **externo** con enlace público.

- Alternativa para desarrollo: una development build también puede distribuirse por TestFlight (perfil con `developmentClient: true` y distribución store) evitando registrar UDIDs ❓ (no verificado en la doc de hoy).

### 7.8 OTA con `expo-updates` / EAS Update ✅

```bash
npx expo install expo-updates
eas update:configure                       # añade runtimeVersion y updates.url
eas update --channel production --message "Ajuste pantalla Semana" --environment production
```

- `--environment` es **obligatorio desde SDK 55** (elige variables de EAS).
- `runtimeVersion.policy`: `appVersion` (cambia al subir `version`; riesgo de desajuste si se olvida tras un cambio nativo) o **`fingerprint`** (cambia automáticamente cuando cambia algo nativo; recomendado, a costa de más builds). En SDK 58 el fingerprint usa el preset `balanced`.
- Solo JS/assets. Cambios en plugins, permisos, entitlements, widgets (❓) o dependencias nativas → nueva build.
- Plan Free: 1.000 MAU de EAS Update (de sobra).

### 7.9 Costes y límites del plan Free (expo.dev/pricing) ✅

- **15 builds iOS + 15 Android al mes**, cola de baja prioridad (esperas de 90+ min en picos), timeout de 45 min.
- Starter: **19 $/mes** + 45 $ de crédito de build, cola prioritaria, 3.000 MAU.
- Estrategia: 1 development build por cambio nativo + OTA para todo lo demás; builds de producción solo para TestFlight.

### 7.10 Pitfalls específicos (HealthKit / App Groups / Windows)

1. **Primera build interactiva** (login Apple con 2FA) para que EAS registre App Group y perfiles del widget.
2. `groupIdentifier` por defecto `group.<bundleId>`; si cambias el bundle ID, cambia el grupo → widgets "vacíos" hasta reinstalar.
3. Registrar **ambos iPhones antes** de la build interna (`eas device:create`); si añades uno después → rebuild o `eas build:resign`.
4. Activar **Modo desarrollador** en iOS para builds internas/dev.
5. HealthKit **no tiene datos en simulador** (irrelevante sin Mac, pero útil saberlo) y la app crashea si consultas tipos sin pedir permiso.
6. Textos de permisos (`NSHealthShareUsageDescription`, calendario, notificaciones) **específicos y en el idioma de la app**: App Review los mira.
7. `background-delivery` de HealthKit está activado por defecto; si no lo usas, `background: false` para no tener que justificarlo.
8. iOS 27: la app es redimensionable y usa `SceneDelegate`; probar layouts en tamaños distintos.
9. La cabecera Liquid Glass transparente (iOS 26+) hace que el contenido pase por debajo → usar `contentInsetAdjustmentBehavior="automatic"` en `ScrollView` o safe areas.
10. Windows: instalar dependencias con `npx expo install` (no `npm i` directo) para versiones compatibles; en `npx expo install … --dev` la doc indica añadir `--` antes de `--dev` en Windows.
11. Firewall de Windows puede bloquear Metro (puerto 8081) → permitir Node en redes privadas o `--tunnel`.
12. No subir `credentials.json`, `.env.local` ni claves `.p8` al repo.
13. `ios.config.usesNonExemptEncryption: false` evita el aviso de cumplimiento de exportación en cada build de TestFlight.

---

## 8. Testing (SDK 58)

### 8.1 Instalación ✅

```bash
# En Windows la doc indica poner "--" antes de --dev
npx expo install jest-expo jest @types/jest -- --dev
npx expo install @testing-library/react-native -- --dev
```

- **SDK 58: `jest-expo` requiere Jest 30** (peer `jest ^29 || ^30`, depende de `babel-jest@30`, `test-renderer@1.3.0`, `jest-environment-*@30`; peer `@react-native/jest-preset ^0.88.0`).
- **`@testing-library/react-native` 14+** obligatorio para `expo-router/testing-library` en SDK 58. RNTL 14 requiere React 19+, RN 0.78+, **Node `^22.13.0 || >=24`** y `test-renderer` 1.x (sustituye al **deprecado** `react-test-renderer`, que hay que desinstalar junto a `@types/react-test-renderer`).
- Codemods de migración: `npx codemod@latest rntl-v14-update-deps` y `npx codemod@latest rntl-v14-async-functions --target ./src`.

### 8.2 Configuración ✅

```json
{
  "scripts": {
    "test": "jest --watchAll",
    "test:ci": "jest --ci --coverage"
  },
  "jest": {
    "preset": "jest-expo",
    "collectCoverage": false,
    "collectCoverageFrom": [
      "src/**/*.{ts,tsx}",
      "!src/app/**/_layout.tsx",
      "!src/widgets/**",
      "!**/node_modules/**"
    ],
    "coverageThreshold": { "global": { "lines": 80, "branches": 70 } }
  }
}
```

- El preset reconoce ficheros `*-test.ts(x)` (y los `__tests__/`). **No poner tests dentro de `src/app/`** (todo fichero ahí es una ruta).
- `transformIgnorePatterns` solo si algún paquete ESM falla (la doc da variantes para npm/pnpm/bun).
- Añadir `coverage/` a `.gitignore`.

### 8.3 Test de componente (API async de RNTL 14) ✅

```tsx
// __tests__/session-card-test.tsx
import { render, screen, fireEvent } from '@testing-library/react-native';
import { SessionCard } from '@/components/session-card';

it('marca la sesión como hecha', async () => {
  const onDone = jest.fn();
  await render(<SessionCard title="Rodaje Z2" minutes={50} onDone={onDone} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Hecho' }));
  expect(onDone).toHaveBeenCalledTimes(1);
});
```

En v14: `render`, `fireEvent.*`, `renderHook`, `rerender`, `unmount` y `act` son **async**; eliminados `update`, `getQueriesForElement` (usar `within`), `UNSAFE_root` y `UNSAFE_get*`.

### 8.4 Tests de navegación ✅

```tsx
import { renderRouter, screen } from 'expo-router/testing-library';

it('abre la hoja de imprevisto', async () => {
  await renderRouter({
    index: () => <HomeMock />,
    'add-event': () => <AddEventMock />,
  }, { initialUrl: '/add-event' });
  expect(screen).toHavePathname('/add-event');
});
```

(Claves sin `./` ni extensión. En SDK 58 hay que `await` `renderRouter` y los métodos de `testRouter`: `navigate`, `push`, `replace`, `back`, `setParams`, `dismissAll`; `canGoBack()` sigue síncrono.)

### 8.5 Mocks de módulos nativos (propuesta)

La lógica que más importa (replanificar la semana ante un imprevisto, calcular carga, detectar huecos libres, mapear sesiones a widget/notificaciones) debe vivir en **TypeScript puro** (`src/domain/**`) y testearse sin mocks. Los adaptadores nativos se mockean:

```ts
// jest.setup.ts  (registrar en package.json > jest: "setupFilesAfterEnv": ["<rootDir>/jest.setup.ts"])
jest.mock('@kingstinct/react-native-healthkit', () => ({
  isHealthDataAvailable: () => true,
  requestAuthorization: jest.fn(async () => true),
  queryWorkoutSamples: jest.fn(async () => []),
  queryQuantitySamples: jest.fn(async () => []),
  queryCategorySamples: jest.fn(async () => []),
  getMostRecentQuantitySample: jest.fn(async () => undefined),
  CategoryValueSleepAnalysis: { inBed: 0, asleepUnspecified: 1, awake: 2, asleepCore: 3, asleepDeep: 4, asleepREM: 5 },
}));
jest.mock('expo-widgets', () => ({
  createWidget: () => ({ updateSnapshot: jest.fn(), updateTimeline: jest.fn(), reload: jest.fn() }),
}));
```

`jest-expo` ya trae mocks para la mayoría de módulos `expo-*` (notifications, calendar…) ⚠️ (comprobar los métodos de la API nueva de `expo-calendar`). E2E (Maestro) queda para más adelante: en EAS Workflows no está incluido en el plan Free.

---

## 9. Riesgos y puntos abiertos

| # | Riesgo / duda | Impacto | Mitigación |
|---|---|---|---|
| 1 | Garmin no exporta HRV/VO2max/Readiness a Apple Salud | Alto (el coach depende de ello) | Integración Garmin directa o vía el Claude del usuario (doc 04/05); HealthKit como complemento |
| 2 | `expo-widgets`: runtime restringido y API joven (Android nuevo en 58) | Medio | Widgets simples (props planas); plan B `@bacons/apple-targets` |
| 3 | OTA no actualiza widgets ❓ | Bajo | Asumir build nativa para cambios de layout del widget |
| 4 | 64 notificaciones locales | Medio | Ventana móvil + push remoto para lo social |
| 5 | Plan Free EAS: 15 builds iOS/mes, colas largas | Medio | Dev build + OTA; Starter (19 $/mes) si se atasca |
| 6 | Primera build con App Groups requiere login Apple interactivo | Bajo | Hacerla desde el terminal, no CI |
| 7 | SMTP por defecto de Supabase limitado | Medio | SMTP propio antes de invitar amigos |
| 8 | Claves legacy de Supabase se deprecan a final de 2026 | Bajo | Empezar ya con `sb_publishable_`/`sb_secret_` |
| 9 | `expo-calendar` API nueva: detalles (`sourceId` al crear calendario en iOS) | Bajo | Probar en dispositivo; fallback `getDefaultCalendarSync()` |
| 10 | "Pádel" no existe como `WorkoutActivityType` | Bajo | Mapear por metadatos/nombre de Garmin; categoría propia en la app |
| 11 | Expo Go SDK 58 no disponible aún | Ninguno | Usamos development builds |

---

## 10. Fuentes

Expo (oficial):
- [Expo SDK 58 changelog](https://expo.dev/changelog/sdk-58) · [How to upgrade to SDK 58](https://expo.dev/blog/how-to-upgrade-to-sdk-58) · [SDK 57](https://expo.dev/changelog/sdk-57) · [SDK 56](https://expo.dev/changelog/sdk-56) · [SDK 55](https://expo.dev/changelog/sdk-55)
- [create-expo-app](https://docs.expo.dev/more/create-expo/) · [Plantilla `expo-template-default@58.0.28` (unpkg)](https://app.unpkg.com/expo-template-default@58.0.28)
- [Native tabs](https://docs.expo.dev/router/advanced/native-tabs/) · [Modals / formSheet](https://docs.expo.dev/router/advanced/modals/) · [Typed routes](https://docs.expo.dev/router/reference/typed-routes/) · [src directory](https://docs.expo.dev/router/reference/src-directory/) · [expo-router SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/router/) · [Linking into your app](https://docs.expo.dev/linking/into-your-app/)
- [expo-widgets v58](https://docs.expo.dev/versions/v58.0.0/sdk/widgets/) · [Blog: iOS widgets and Live Activities in Expo](https://expo.dev/blog/ios-widgets-and-live-activities-in-expo) · [CHANGELOG expo-widgets 58.0.23](https://unpkg.com/expo-widgets@58.0.23/CHANGELOG.md) · [`@expo/ui` widgets modifiers](https://unpkg.com/@expo/ui@58.0.23/src/swift-ui/modifiers/widgets.ts)
- [expo-notifications v58](https://docs.expo.dev/versions/v58.0.0/sdk/notifications/) · [Push setup](https://docs.expo.dev/push-notifications/push-notifications-setup/) · [Sending notifications (Expo Push API)](https://docs.expo.dev/push-notifications/sending-notifications/)
- [expo-calendar v58](https://docs.expo.dev/versions/v58.0.0/sdk/calendar/) · [expo-apple-authentication v58](https://docs.expo.dev/versions/v58.0.0/sdk/apple-authentication/) · [expo-background-task v58](https://docs.expo.dev/versions/v58.0.0/sdk/background-task/)
- [Using Supabase (Expo)](https://docs.expo.dev/guides/using-supabase/)
- [EAS Build setup](https://docs.expo.dev/build/setup/) · [eas.json](https://docs.expo.dev/build/eas-json/) · [Internal distribution](https://docs.expo.dev/build/internal-distribution/) · [iOS capabilities](https://docs.expo.dev/build-reference/ios-capabilities/) · [App extensions](https://docs.expo.dev/build-reference/app-extensions/) · [Submit iOS](https://docs.expo.dev/submit/ios/) · [EAS env vars](https://docs.expo.dev/eas/environment-variables/) · [EAS Update](https://docs.expo.dev/eas-update/getting-started/) · [Runtime versions](https://docs.expo.dev/eas-update/runtime-versions/) · [App config](https://docs.expo.dev/workflow/configuration/) · [Pricing](https://expo.dev/pricing)
- [Unit testing con jest-expo](https://docs.expo.dev/develop/unit-testing/) · [Expo Router testing](https://docs.expo.dev/router/reference/testing/) · [Expo Go y App Store (may-2026)](https://expo.dev/changelog/expo-go-and-app-store-may-2026)

Librerías:
- [kingstinct/react-native-healthkit (GitHub)](https://github.com/kingstinct/react-native-healthkit) · [Releases v16](https://github.com/kingstinct/react-native-healthkit/releases) · [Docs](https://kingstinct.com/react-native-healthkit/) · Código fuente v16.2.0 en unpkg: [`CoreModule.nitro.ts`](https://unpkg.com/@kingstinct/react-native-healthkit@16.2.0/src/specs/CoreModule.nitro.ts), [`QuantityTypeModule.nitro.ts`](https://unpkg.com/@kingstinct/react-native-healthkit@16.2.0/src/specs/QuantityTypeModule.nitro.ts), [`Workouts.ts`](https://unpkg.com/@kingstinct/react-native-healthkit@16.2.0/src/types/Workouts.ts), [`app.plugin.ts`](https://unpkg.com/@kingstinct/react-native-healthkit@16.2.0/app.plugin.ts), [plugin core](https://unpkg.com/@react-native-healthkit/core@16.2.0/src/plugin/index.ts)
- [EvanBacon/expo-apple-targets](https://github.com/EvanBacon/expo-apple-targets) · [README del paquete](https://raw.githubusercontent.com/EvanBacon/expo-apple-targets/main/packages/apple-targets/README.md)
- [RNTL migración a v14](https://oss.callstack.com/react-native-testing-library/docs/start/migration-v14)

Supabase:
- [Quickstart Expo React Native](https://supabase.com/docs/guides/getting-started/quickstarts/expo-react-native) · [API keys](https://supabase.com/docs/guides/api/api-keys) · [Passwordless email / OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless) · [Login with Apple](https://supabase.com/docs/guides/auth/social-login/auth-apple) · [signInWithIdToken (Dart, nonce)](https://supabase.com/docs/reference/dart/auth-signinwithidtoken) · [Push notifications con Edge Functions](https://supabase.com/docs/guides/functions/examples/push-notifications)

Apple:
- [TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview) · [Add internal testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers) · [TestFlight](https://developer.apple.com/testflight/) · [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) · [Foro: límite de 64 notificaciones](https://developer.apple.com/forums/thread/811171)

Secundarias (⚠️):
- [reactnativerelay.com — widgets con apple-targets (ago-2026, desactualizado sobre expo-widgets)](https://reactnativerelay.com/article/react-native-ios-widgets-expo-apple-targets-2026)
- [Teambuildr — datos Garmin → Apple Health](https://support.teambuildr.com/article/hb5cr5450r-guide-to-garmin-integration) · [Vitals Sync (App Store)](https://mwm.ai/apps/vitals-sync/6780623839) · [Notebookcheck — fases de sueño Garmin → Apple Health](https://www.notebookcheck.net/Garmin-Connect-begins-sharing-more-sleep-data-with-Apple-Health-after-new-iOS-app-update.753484.0.html)
