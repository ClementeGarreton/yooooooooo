# NLP simple — cierre del cotizador de WhatsApp (08-11-2026)

## Flujo vigente para sesiones Tommy (intake.tommyVersion = 1)

**Bienvenida → texto natural del cliente → una llamada OpenAI Responses (gpt-6.1-sol, razonamiento low) → JSON estructurado → quote_sessions.state → precio oficial y PDF.**

- Ya NO se ejecutan, en esta rama, los parsers por regex, diff y formularios de `tommyFlow`, `tommyAccess`, `freeformIntake`, `parseGeneralWhatsAppTurn` ni `parseWhatsAppInventory`.
- Los módulos originales se preservan porque los utilizan rutas y sesiones anteriores. No se borraron funcionalidades ajenas al cotizador Tommy.
- Se acepta un mensaje libre directamente después de la bienvenida, sin palabra clave. Si el cliente elige `1` / `COTIZAR`, recibe el formulario de 6 grupos y también puede responder libremente.
- El parser recibe el texto **íntegro**, y la información previamente guardada como contexto, además del catálogo activo para vincular muebles a IDs reales.
- Solo el estado confirmado se conserva entre mensajes. No se sobrescriben valores con `null`. No se suman accidentalmente muebles repetidos.
- Las respuestas incompletas no habilitan precios inventados: se pregunta únicamente por grupos faltantes, con un máximo de **3 mensajes de preguntas** (el inicial, si se envió, cuenta como uno). Agotado ese límite, el cliente puede enviar datos voluntariamente; no hay otra ronda de interrogatorio.
- La operación de guardado es `saveQuoteSession()` sobre `quote_sessions.state` de Supabase. Este proyecto no contiene una función llamada `storeQuote`, aunque ese es el almacén lógico al que se refiere el requisito.
- El PDF sigue usando `generatePreliminaryWhatsAppQuote()`, el motor de precios y tarifas administrativas vigentes. No vuelve a depender de `handoff_requests`.
- Un error de red o API se registra como error técnico; jamás se finge que el cliente habló mal.

## Archivos clave

- `src/lib/whatsapp/rawNlpQuote.ts`: parser único y transformación a estado.
- `src/lib/whatsapp/incomingProcessor.ts`: ruta nueva al parser y persistencia.
- `src/lib/whatsapp/botRouter.ts`: entrada por lenguaje natural tras la bienvenida, y números 1/2/3 no activan el menú mientras se cotiza.
- `src/lib/quoteSession.ts`: contador de preguntas en JSONB; no requiere migración.
- `src/lib/ai/openai.ts`: selector de modelo exclusivo de la llamada NLP.
- `src/lib/serverQuoteEngine.ts`: no cobrar escaleras cuando el cliente confirma que no se usarán.

## Configuración

- Requiere `OPENAI_API_KEY` y Supabase existente.
- Modelo predeterminado para NLP: `gpt-6.1-sol`, razonamiento `low`, para equilibrar calidad y velocidad. Se puede cambiar **solo el modelo** con `OPENAI_NLP_MODEL`.
- Las variables generales `OPENAI_MODEL` y `OPENAI_REASONING_EFFORT` no reemplazan el modelo ni esfuerzo de esta ruta NLP.
- No instalar nada ni ejecutar migraciones para este cambio.

## Validación ejecutada / pendiente

Verificado mediante pruebas aisladas con simulación de OpenAI y catálogo: una llamada por mensaje, texto inalterado, seis grupos reconocidos, `50mts`, no duplicación de inventario, no aceptar IDs inexistentes y reconocimiento de números del menú vs respuestas de cotización. Se revisó la sintaxis TypeScript de los seis archivos modificados.

**No se ejecutó** un `npm run build` completo ni una prueba con OpenAI real/WhatsApp real. La instalación de dependencias se bloqueó en este entorno. Debe validarse antes de producción, preferentemente desplegando una preview en Vercel.

## Reversiones

Conservar una copia del último despliegue que generó correctamente el PDF (`YoMeEncargo_Cotizacion_PDF_Sin_Derivacion_2026-11-08.zip`). Si el nuevo parser falla en preview, volver a ese commit sin alterar datos ya guardados.
