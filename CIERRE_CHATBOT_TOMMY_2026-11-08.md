# YoMeEncargo — corrección de conversación WhatsApp (8 noviembre 2026)

Base: proyecto que generó PDF de cotización estimativa. No se reactivó `handoff_requests` ni se cambiaron las tarifas.

## Cambios verificados en pruebas automatizadas

- Primer recordatorio: seis temas, no subpreguntas técnicas mezcladas desde el inicio.
- Aclaración de acceso: cuatro decisiones breves por número; después, solo cuando hagan falta, muebles (TODOS o cuáles) y pisos.
- Respuestas breves: `1 sí, 2 no, 3 no, 4 sí` para acceso y `4.1 sí; 4.2 no` sin copiar mensaje. Para detalles acepta `4.5 TODOS; 4.7 1`.
- Respuestas `5: 50mts`, `5) 50 metros`, `6: no` se reconocen sin volver a preguntar el dato.
- Copiar el formulario sin completarlo NO se considera respuesta. El ejemplo de formato en el mensaje del bot tampoco se interpreta como respuesta.
- Si una respuesta está confirmada, no aparece entre los pendientes; el inventario original permanece, y `TODOS` evita tener que copiarlo de nuevo.
- Conserva la ruta de cotización preliminar y PDF, sin exigir nombre o correo al cliente para ese PDF.

## Pruebas y limitaciones

- `node --experimental-strip-types --test tests/whatsapp-*.test.mjs`: 164/164 correctas.
- Los 4 archivos TypeScript cambiados se analizan sintácticamente sin diagnósticos usando `typescript.transpileModule`.
- `npm ci` no terminó en este entorno; por ello NO se certificó `next build` ni el funcionamiento con el WhatsApp real.
- Se requiere `npm ci && npm run build` y una prueba real en entorno de staging antes de sustituir producción.

## Prueba de aceptación corta

1. Cotizar: enviar los seis apartados con direcciones, fecha, inventario, `5: 50mts` y `6: no`. El bot NO debe volver a preguntar la distancia.
2. Confirmar accesos con `1 sí, 2 no, 3 no, 4 sí`. Debe faltar solamente la selección de muebles por escaleras y pisos destino.
3. Responder `4.5 TODOS; 4.7 1`. El bot debe generar cotización y PDF sin repetir inventario ni acceso ya informado.

Archivos centrales: `src/lib/whatsapp/incomingProcessor.ts`, `tommyFlow.ts`, `tommyAccess.ts`, `tommyDifferential.ts`.
