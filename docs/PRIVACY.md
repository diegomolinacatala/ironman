# Política de privacidad de Road to Ironman

**Responsable:** Diego Molina · Contacto: [diegomolinacatala@gmail.com](mailto:diegomolinacatala@gmail.com) · Última actualización: 26 de noviembre de 2026

## Qué datos tratamos y para qué

| Datos | Origen | Para qué |
|---|---|---|
| Email y nombre (o Apple ID anónimo) | Tú, al crear la cuenta | Iniciar sesión e identificarte ante tus amigos |
| Perfil deportivo: deportes, nivel, umbrales, disponibilidad, notas para el coach | Tú | Planificar tus entrenos |
| Entrenos planificados y realizados, carreras, imprevistos, check-in diario, nutrición | Tú, tu Claude (si lo conectas) | Tu calendario, tu carga y las propuestas de cambios |
| Datos de salud de **Apple Salud** (entrenos, sueño, frecuencia cardiaca, respiración durante el sueño, VFC, pasos) | Apple Salud, solo con tu permiso | Marcar entrenos como hechos, estimar tu recuperación y avisarte si la noche apunta a que te estás poniendo malo |
| Métricas de **Garmin** (sueño, VFC, respiración y pulso durante el sueño, Body Battery, actividades) | Tu clave personal de Garmin, solo si la conectas | Lo mismo que el anterior |
| Horas ocupadas de tu **calendario** (inicio y fin; el título solo lo ves tú) | Calendario del iPhone, solo con tu permiso | Encontrar huecos para entrenar |
| Tus entrenos, escritos en un calendario «Road to Ironman» de tu iPhone | La app, solo si lo activas | Que veas tus sesiones en tu calendario con un aviso antes |
| Lo que le dices o escribes a tu coach (la voz se convierte en texto **en el iPhone**) | Tú | Entender lesiones, cambios de planes y preferencias, y ajustar tu plan |
| Fotos de tus comidas (se guardan **solo en tu iPhone**) y lo que apuntas que comes | Tú | Estimar lo que comes y darte consejos para entrenar |
| Informe de cada mañana (texto generado con tu sueño y tu plan del día) | La app | Contarte cómo has dormido y qué te toca; se lee en voz alta en el iPhone |
| **Tu ciudad para el tiempo** (nombre y coordenadas de la ciudad que eliges; nunca la ubicación del iPhone) | Tú, solo si la añades en *Tú › Entrenamiento* | Mirar la previsión y proponerte entrenar en un hueco seco o a cubierto |
| Mensajes en las quedadas, kudos y tu @usuario | Tú | Que tus amigos te encuentren y os organicéis |
| Denuncias que envías (motivo, a quién y el mensaje denunciado) y bloqueos | Tú | Revisar abusos y que no te contacte quien bloqueas |
| Token de notificaciones | Tu iPhone | Enviarte avisos |

**No** vendemos datos, **no** hay publicidad y **no** usamos tus datos de salud para marketing.

## Con quién se comparten

- **Tus amigos en Road to Ironman**, solo lo que elijas en *Privacidad* (todo, resumen sin títulos o solo
  ocupado). Nunca ven tus datos de salud, tus lesiones ni los títulos de tus eventos de calendario.
- **Encargados del tratamiento** que hacen funcionar el servicio:
  - Supabase (base de datos y autenticación, servidores en la UE).
  - Apple (envío de notificaciones push).
  - **Cloudflare (Workers AI)**, solo si das tu permiso a la IA del coach: recibe un resumen de tu plan,
    tu sueño y tus métricas, lo que le cuentas al coach y, cuando analizas una comida, la foto. Lo usa
    solo para generar la respuesta: según Cloudflare, no guarda esas entradas ni salidas y no las usa
    para entrenar modelos. Nunca le enviamos los títulos de tus eventos del calendario. Puedes retirar el
    permiso en *Tú › Privacidad* y la app sigue funcionando con reglas automáticas.
- **Servicios del tiempo**, solo si añades tu ciudad, y siempre desde nuestro servidor (no reciben tu
  dirección IP, tu nombre ni tu cuenta):
  - **MET Norway** (Instituto Meteorológico de Noruega) recibe las coordenadas de tu ciudad redondeadas
    a unos 1 km para devolver la previsión. Los datos del tiempo son suyos (licencia CC BY 4.0).
  - **Nominatim (OpenStreetMap)** recibe el texto que escribes al buscar tu ciudad. Guardamos las
    búsquedas (sin saber quién las hizo) 30 días para no repetirlas.
  Puedes quitar tu ciudad cuando quieras en *Tú › Entrenamiento › Tu ciudad para el tiempo*.
- **Tu propio Claude**, solo si tú creas el conector: lo que tu Claude lea o escriba en la app queda
  sujeto también a tu relación con Anthropic. La app no envía nada a Anthropic por su cuenta.

## Datos de salud (HealthKit)

Los datos de Apple Salud solo se leen con tu permiso y se usan exclusivamente para las funciones de
entrenamiento descritas. No se usan para publicidad ni se venden ni se comparten con terceros salvo
los encargados anteriores para prestarte el servicio. Puedes retirar el permiso en *Ajustes > Salud*.

## Conservación y borrado

Conservamos tus datos mientras tengas cuenta. En **Tú > Borrar cuenta** eliminas tu cuenta y todos tus
datos de forma inmediata e irreversible (si entraste con Apple, también revocamos el acceso de la app a
tu Apple ID). Las claves de Garmin se guardan cifradas y se borran al desconectar.

## Tus derechos

Puedes acceder, rectificar, exportar u oponerte al tratamiento escribiendo a [diegomolinacatala@gmail.com](mailto:diegomolinacatala@gmail.com).
Si no estás conforme, puedes reclamar ante la Agencia Española de Protección de Datos (aepd.es).

## Menores

Road to Ironman no está dirigida a menores de 16 años.
