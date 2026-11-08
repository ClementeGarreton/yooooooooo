# YoMeEncargo — Cotización directa PDF (8 noviembre 2026)

## Cambio puntual

- La rama de `finishTommyQuote` **ya no consulta ni escribe** en `public.handoff_requests`.
- Cuando los seis grupos de Tommy quedan completos, calcula el precio estimado usando el motor actual (`calculateSessionQuote`), genera un PDF con `jsPDF` y lo guarda en el bucket `bookings` de Supabase.
- Se envían el precio estimativo, el enlace al PDF y el adjunto por WhatsApp. Si falla el adjunto, el cliente mantiene el enlace.
- El nombre y correo NO son obligatorios para este PDF preliminar; aparecen como «No informado». Si no se indicó hora, figura como «Por confirmar» y no se inventa una hora para la tarifa.
- La cotización queda almacenada en `quote_sessions` con estado `quoted`. No se crea un prospecto con identidad ficticia.
- Si falla el cálculo o la subida del PDF, **se conserva la sesión** y se permite reintentar con `CONFIRMAR` sin repetir el formulario.
- Se dejaron comentadas las llamadas a las funciones de derivación que dependen de la tabla `handoff_requests`. Su reactivación exige la migración y un flujo de atención validado.

## Integración

Reemplazar el código completo de la rama actual con este proyecto. No se necesita crear `handoff_requests` para generar la cotización WhatsApp. Se mantiene el bucket `bookings` y la tabla `quote_sessions` que el cotizador ya utilizaba. El cálculo de precios requiere el catálogo y la configuración de tarifas existentes.

## Pruebas ejecutadas

- `node --experimental-strip-types --test tests/whatsapp*.test.mjs`: **158 pruebas aprobadas**.
- Transpilación TypeScript de `incomingProcessor.ts` y `serverQuoteEngine.ts`: **sin errores de sintaxis**.
- `npm run build`: **NO VERIFICADO**. Este entorno no dispone de las dependencias completas de Next.js. Ejecutar `npm ci && npm run build` en VS Code o Vercel y revisar el resultado antes de producción.
- **NO se probó** contra Supabase, Meta WhatsApp ni OpenAI reales.

## Prueba de aceptación en WhatsApp

1. Escribir `COTIZAR`, responder los seis grupos de Tommy. La fecha, origen, destino e inventario deben quedar realmente definidos en la sesión.
2. Si aparecen preguntas 4.1 a 4.7 de escaleras, contestarlas una sola vez. Los servicios no deben volver a solicitarse si ya fueron respondidos.
3. El siguiente mensaje debe incluir el **precio estimado** y el **PDF** (adjunto o enlace). No debe aparecer «no se pudo consultar derivación».
4. Si la generación de PDF falla, revisar `[WhatsApp][cotización]` en Vercel Logs y escribir `CONFIRMAR` sin repetir datos.

NOTA: Este flujo no crea ni deriva tickets a secretaría. La cotización es estimativa, no una reserva confirmada ni una oferta definitiva.
