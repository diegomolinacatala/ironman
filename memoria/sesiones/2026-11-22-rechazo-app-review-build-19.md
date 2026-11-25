# Rechazo de App Review, build 19

**Autor:** Claude Code · 22-11-2026 · desde `9329326` (main).

**Objetivo.** Responder al rechazo de la 1.0.0 (19): 5.1.1(iv), 2.5.4 y 2.1.

**Cambios.**
- 5.1.1(iv). Antes de un permiso de iOS no puede haber «Permitir» ni «Ahora no». Ahora el paso *Calendario* del onboarding solo tiene «Continuar», que siempre abre el aviso. Si se deniega, aparece «Continuar sin calendario». En *Informe* solo queda «Continuar», que abre el aviso de notificaciones. En COROS, «Seguir sin reloj» se oculta mientras se ve la guía de Apple Salud y vuelve a aparecer tras el aviso o tras un fallo. En Tú los botones se llaman «Activar avisos» y «Conectar calendario».
- 2.5.4. Se quita `audio` de `UIBackgroundModes` en `app.config.ts` y `scripts/ios/check-info-plist.mjs`. El informe hablado ya usaba `shouldPlayInBackground: false`.
- 2.1. Las notas de revisión (`store/listing.json`) aclaran que la app no se empareja con ningún hardware. El campo nuevo `review.demoVideoUrl` (o el secreto `ASC_DEMO_VIDEO_URL`) pone el enlace al principio de las notas. El script avisa si falta.
- En `docs/APP_STORE.md` están la tabla del rechazo, el guion del vídeo y la respuesta en inglés.

**Comprobaciones.** `npm run test:all` en verde.

**Pendiente.** Faltan cinco pasos. (1) El dueño graba el vídeo con iPhone y Garmin y lo sube oculto a YouTube. (2) Rellenar `demoVideoUrl`. (3) Generar la build 20. (4) Lanzar el workflow App Store con *submit*. (5) Responder en el Centro de resoluciones con el texto de `docs/APP_STORE.md`.
