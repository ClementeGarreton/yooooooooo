# Asistente de WhatsApp (rama `feat/bot-whatsapp`, 11-10-2026)

Código del desarrollador externo («MVP 1.3.2»), portado sobre el `main` actual. Se portó
**solo el bot de WhatsApp**: no entraron el asistente de inventario del cotizador web, el
chat de ventas, la reanudación de la cotización en la web ni la pestaña «Conversaciones IA».

## Qué hace
Cotiza una mudanza por WhatsApp en 7 pasos (datos, fecha, direcciones, propiedades,
inventario por texto o fotos, servicios, resumen), guarda el prospecto con origen
`whatsapp` y manda el PDF. «EJECUTIVO» deja la conversación a una persona.

## Archivos
- `src/app/api/whatsapp/webhook/route.ts` — webhook de Meta (GET de verificación, POST firmado).
- `src/lib/whatsapp/cloudApi.ts` — envío de mensajes y descarga de imágenes por Graph API.
- `src/lib/quoteSession.ts`, `src/lib/ai/*` — sesión de cotización y lectura de mensajes con OpenAI.
- `src/lib/serverQuoteEngine.ts` — cotización, prospecto y PDF.
- `src/lib/whatsappBot.ts` — número, texto de entrada y enlace del footer.
- `src/app/api/admin/whatsapp/status/route.ts` — qué variables están cargadas (sin valores).

## Cambios respecto del código recibido
1. **Precio con la fórmula oficial.** El motor traía una copia propia de la fórmula y de los
   precios. Ahora llama a `calculateQuote` con `readPricingConfig` y mide la distancia igual
   que `/api/quote/calculate`: mismo valor que la web, y sigue los cambios de Configuración.
2. **Prospecto por `upsertQuoteProspect`**, la misma función de la web y del panel.
3. **No responde a todo.** El número es el de la atención de siempre (Coexistencia). El bot
   solo contesta a quien entra por el enlace «Cotizar por WhatsApp (asistente)» del footer
   —que deja escrito un texto reconocible— o a quien tiene una cotización suya en curso con
   actividad en las últimas 24 horas. Entregada la cotización o pasada a un ejecutivo, calla.
4. **Interruptor `WHATSAPP_BOT_ENABLED`.** Si no vale `true`, el webhook recibe y no responde.
   La verificación de Meta (GET) funciona igual, así que se puede desplegar apagado.
5. **PDF por el dominio del sitio** (`/archivos/...`), no por la URL del almacenamiento.
6. Sin enlace de «revisar en la web»: esa pantalla no se portó.

## Base de datos
Nada que correr. Las tablas `quote_sessions`, `ai_conversations`, `ai_messages` y
`ai_actions` ya existen (versión corregida, sep-2026) y `whatsapp` ya es un origen válido.
**No correr** `add_ai_conversations_and_quote_sessions.sql` del zip: reescribe los orígenes
permitidos y deja fuera valores en uso.

## Variables (Vercel, solo servidor)
`WHATSAPP_BOT_ENABLED`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
`WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET`, `WHATSAPP_GRAPH_VERSION`, `OPENAI_API_KEY`,
`OPENAI_MODEL` (opcional). En ese equipo las variables son «Shared»: hay que vincularlas al
proyecto y redesplegar.

## Encendido
1. Cargar las variables con `WHATSAPP_BOT_ENABLED=false` y desplegar.
2. En Meta, apuntar el webhook a `https://yomeencargo.cl/api/whatsapp/webhook` con el verify token.
3. Cuando Meta apruebe y se complete Coexistencia, pasar `WHATSAPP_BOT_ENABLED=true` y redesplegar.
4. Probar desde un teléfono externo entrando por el enlace del footer.
