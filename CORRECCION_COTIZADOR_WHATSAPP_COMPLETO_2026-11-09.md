# Corrección de recopilación de WhatsApp (9 de noviembre de 2026)

## Flujo único

1. Un mensaje inicial con las preguntas de los datos requeridos del cotizador web, redactadas por temas en lenguaje normal.
2. El cliente responde en texto libre, en el orden que quiera. OpenAI entrega un JSON con TODAS las variables interpretables, distinguiendo `null` (no respondido), `false` (no) y `0`.
3. El servidor actualiza `quote_sessions.state` con compare-and-swap, sin borrar respuestas previamente confirmadas.
4. Si falta algo, envía un solo mensaje con **todos los campos pendientes**, agrupados. No crea un flujo de una pregunta por turno, no repite respuestas y no deja de preguntar por alcanzar un contador.
5. Si todo está contestado, calcula mediante `calculateQuote`, incluyendo paradas de la ruta y extras (ayudantes, desarmado de refrigerador, prioridad) y genera el PDF. Se guarda también el `quote_state` completo del prospecto, apto para cotizador web.

Las direcciones tienen información de origen y destino separadas; piso, ascensor y acarreo son variables independientes. Las derivadas (`volumen`, `peso`, `cuadrilla`, `vehículo`, `distancia` y `precio`) se obtienen con el catálogo y el motor oficial, no se preguntan al cliente. Fotos y observaciones son opcionales.

## Qué se modificó

- `src/lib/whatsapp/rawNlpQuote.ts`: NLP completo, validación de pendientes, redacción de preguntas agrupadas y merge de respuestas.
- `src/lib/quoteSession.ts`: paradas, servicios extra y marcas de respuesta en la sesión persistente.
- `src/lib/whatsapp/incomingProcessor.ts`: elimina el flujo de seis preguntas, el límite arbitrario y las escrituras que podían pisar respuestas simultáneas.
- `src/lib/serverQuoteEngine.ts`: mismo motor de precios, paradas intermedias, extras y persistencia del prospecto web; no genera PDF si quedan variables por resolver.
- `tests/whatsapp-full-quote-state.test.cjs`: pruebas de estado completo, negaciones, ceros, repregunta y factura.

## Verificación

Ejecutado: `node --test tests/whatsapp-full-quote-state.test.cjs` (5 pruebas aprobadas).
No pudo ejecutarse el build de Next.js en este entorno porque `npm ci` no terminó de instalar las dependencias. Antes de desplegar: `npm ci && npm run build` y una prueba end-to-end contra la API real de WhatsApp/Supabase/OpenAI.

**Importante:** la generación de cotizaciones basadas en fotografías sigue siendo una vía diferente y requiere una prueba de integración propia; este cambio corrige el flujo de texto natural descrito por el cliente.
