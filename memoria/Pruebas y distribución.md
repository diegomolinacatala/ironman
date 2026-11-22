# Pruebas y distribución

El repositorio utiliza npm y `package-lock.json`. Para una copia nueva, `npm ci` instala lo fijado y `npm run web` permite explorar la demo. Antes de escribir código de Expo o React Native, leer la versión de Expo en `package.json`, consultar la documentación de ese SDK y seguir `AGENTS.md`. Las dependencias Expo se instalan con `npx expo install`.

| Comprobación | Comando o ubicación | Qué acredita |
| --- | --- | --- |
| Tipado | `npm run typecheck` | Compatibilidad TypeScript del proyecto configurado. |
| Lint | `npx expo lint` | Diagnóstico estático. El comportamiento encontrado en esta copia está en [[Estado y relevo]]. |
| Dominio, UI y adaptadores | `npm test` | Jest, con sustitución de Reanimated en el entorno de prueba. |
| Base de datos | `npm run test:db` | PGlite, contratos SQL, privacidad y permisos entre cuentas. |
| Funciones | `npm run test:functions` | Contratos de Edge Functions, proveedores, MCP, calendario y servicios. |
| Conjunto principal | `npm run test:all` | Tipado, Jest, base de datos y funciones, en ese orden. |
| Worker de IA | `node --test "cloudflare/ai/src/**/*.test.mts"` | Suite propia de chat, HTTP y voz. |
| Dependencias nativas | `node scripts/ios/check-prebuilt-abi.mjs` | Detecta incompatibilidades que ya produjeron cierres al arrancar. |
| Dispositivo real | iPhone con build adecuada | Apple Salud, permisos, notificaciones, widgets, voz e instalación nativa. |

**De la rama al teléfono.** El workflow `.github/workflows/ios.yml` filtra los cambios de main por rutas relevantes, genera el proyecto iOS con prebuild, compila con Xcode y, con credenciales, firma y sube a TestFlight. También admite ejecución manual y tiene programación periódica. El proyecto prescinde de EAS. No editar a mano los directorios nativos generados. Los cambios de esta bóveda quedan fuera de los filtros de compilación.

**De TestFlight a revisión.** `.github/workflows/app-store.yml` y `scripts/asc` gestionan ficha y envío con App Store Connect. La ficha y las capturas viven en `store`. `docs/APP_STORE.md` describe la parte humana. Revisar la cuenta de prueba y las salidas del onboarding antes de mandar otra build. El historial reciente trata reenvío tras rechazo y disponibilidad territorial. El estado actual de revisión se consulta en App Store Connect.

**Web pública.** `.github/workflows/pages.yml` publica soporte, privacidad y normas mediante GitHub Pages. Las fuentes de los textos son `docs/PRIVACY.md` y `docs/TERMS.md`. Supabase y el Worker tienen su propio despliegue según `docs/SETUP.md` y `supabase/functions/README.md`; una compilación iOS por sí sola no acredita que una migración esté aplicada.
