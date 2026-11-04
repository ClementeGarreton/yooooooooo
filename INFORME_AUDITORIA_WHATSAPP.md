# Auditoría técnica — Cotizador Por Teléfono / WhatsApp

**Fecha:** 4 de noviembre de 2026.  
**Origen:** `Proyecto(1).rar` (copia adjunta por el cliente).  
**Alcance:** análisis estático de la base del proyecto, rutas API/middleware y examen detallado del flujo WhatsApp (entrada, autorización, estado, respuesta, registro y conexión con Meta).

## Resultado

- Se extrajeron 276 archivos del proyecto (sin `.git`, credenciales ni dependencias generadas).
- Se revisó la sintaxis de **185 archivos JavaScript/TypeScript/TSX**: **0 errores**.
- Se ejecutaron **71 pruebas locales** de WhatsApp e Instagram: **71 aprobadas**.
- **No fue posible** ejecutar el `next build` completo porque las dependencias no se pudieron instalar offline en el entorno de auditoría. El proyecto no se probó con Supabase/Meta/Vercel reales; por tanto, **no se certifica aún el funcionamiento en producción**.

## Hallazgos y correcciones implementadas

1. **Webhook sin diagnóstico ante un número diferente.** El parser filtra `metadata.phone_number_id` por `WHATSAPP_PHONE_NUMBER_ID` y `WHATSAPP_SECRETARY_PHONE_NUMBER_ID`. Esto es necesario para no contestar desde números ajenos, pero los mensajes descartados no generaban información para saber por qué el bot callaba. **Corregido:** se contabilizan entradas, mensajes admitidos, mensajes descartados por ID y notificaciones de estado, sin registrar teléfonos de clientes, conversaciones ni tokens.

2. **Saludo silenciado por estado previo.** En modo `idle`, un cliente que hubiese recibido antes el menú podía escribir «hola» y obtener deliberadamente `silent`. Un cambio de número no borra las conversaciones guardadas y puede conservar ese estado. **Corregido:** un saludo explícito en `idle` solicita la bienvenida aunque exista una conversación previa; sigue respetando el silencio del modo de atención humana y la activación explícita de `COTIZAR`. Se agregó una reparación localizada para estados `active` antiguos que ya no tengan una cotización válida.

3. **Poca trazabilidad de fallos de envío.** El código original propagaba el texto del error Graph sin el código HTTP/subcódigo. **Corregido:** ahora incluye HTTP, error.code y error_subcode en la excepción; además, impone un timeout de 25 segundos a las solicitudes Graph. No expone el token ni los mensajes en logs.

4. **Un JSON inválido recibía `200` como si se hubiese procesado.** **Corregido:** el webhook firmado devuelve `400` al recibir JSON inválido y registra el motivo. Los POST con firma inválida se rechazan y quedan registrados sin publicar secretos.

5. **Enlaces de cotización con URL antigua de pruebas.** Si no se fija `WHATSAPP_QUOTE_BASE_URL`, se usaba `yo-me-encargo-test97.vercel.app`. **Corregido:** se prioriza `WHATSAPP_QUOTE_BASE_URL`, luego `NEXT_PUBLIC_APP_URL` y `VERCEL_PROJECT_PRODUCTION_URL`; la URL heredada solo queda como último recurso de compatibilidad.

6. **Bot apagado o mensajes duplicados sin diagnóstico específico para WhatsApp.** **Corregido:** Vercel registra estados `BOT_ENABLED=false`, decisiones `welcome/silent/...` y duplicados, sin datos sensibles.

## Verificaciones que NO justifican cambiar la configuración

- El código usa `WHATSAPP_PHONE_NUMBER_ID` para `POST /{phone-number-id}/messages`, como exige Cloud API. **No debe sustituirse por el WABA ID.**
- El webhook `GET` solo verifica el callback, no acredita el éxito de la recepción de `POST`.
- La ruta `/api/whatsapp/webhook` está expresamente **exenta del limitador de peticiones** de `middleware.ts`; éste no debería bloquear tráfico legítimo de Meta por cuota.
- El `.env` adjunto por separado contiene las variables necesarias y coincide con el identificador de teléfono indicado, pero no prueba qué valores tiene Vercel en Producción. **Ningún secreto se incluye en este paquete.**

## Riesgos pendientes (no alterados por prudencia)

- El procesamiento completo del webhook (con OpenAI, Supabase y PDFs) ocurre dentro del POST. Si supera los límites del servicio, puede fallar o recibir reintentos. La solución sólida a largo plazo es aceptar/encolar el evento y procesarlo en un trabajador durable, con deduplicación y reintentos. **No se hizo este cambio de arquitectura sin infraestructura de colas**, porque puede romper cotizaciones ya existentes.
- La inserción del ID entrante en base de datos ocurre antes de enviar la respuesta; fallas posteriores pueden dejarlo marcado como procesado y dificultar reintentos. La solución segura requiere estados durables y reintentos transaccionales, no simplemente eliminar la deduplicación.
- La capa Next.js está en la versión `14.1.0`; planificar una actualización de dependencias por mantenimiento/seguridad por separado, con build y pruebas completos.
- La captura del depurador mostró un token en la URL. **Revocarlo y generar uno nuevo privado**. No pegar tokens completos en el chat, commits ni capturas.

## Aplicación y prueba de producción

1. Respaldar el commit actual. Aplicar el parche o reemplazar el proyecto por la versión auditada; confirmar que el nuevo código se desplegó en el dominio correcto.
2. Mantener los valores actuales de `WHATSAPP_PHONE_NUMBER_ID` y `WHATSAPP_VERIFY_TOKEN`. Confirmar `META_APP_SECRET` en Vercel y utilizar un `WHATSAPP_ACCESS_TOKEN` **nuevo y privado** con acceso a *Secretario Virtual*. Volver a desplegar para que Vercel use el token.
3. Escribir `Hola` desde **otro** teléfono a `+56 9 5075 5567` y abrir **Vercel → Logs** para `POST /api/whatsapp/webhook`.
4. Interpretación del diagnóstico:
   - Sin `POST`: investigar suscripción/entrega de Meta y URL callback.
   - `401 / firma inválida`: revisar `META_APP_SECRET` (secreto de la aplicación) en Producción.
   - `Evento recibido ... ignoredPhoneMessages > 0`: revisar identificador del número que Meta entrega.
   - `Evento recibido ... matchedMessages > 0`, luego `Decisión welcome` y error `WhatsApp Graph API HTTP ...`: revisar autorización de envío, token y Graph API.
   - `Decisión silent`: inspeccionar modo `human` o estados heredados; `MENU` permite volver al menú.
   - Sin error y respuesta de Meta aceptada: confirmar recepción en el teléfono cliente.

## Archivos modificados

- `src/app/api/whatsapp/webhook/route.ts`
- `src/lib/whatsapp/botRouter.ts`
- `src/lib/whatsapp/botStateStore.ts`
- `src/lib/whatsapp/cloudApi.ts`
- `src/lib/whatsapp/incomingProcessor.ts`
- `src/lib/whatsapp/webhookDiagnostics.ts` (nuevo)
- `tests/whatsapp-webhook-diagnostics.test.mjs` (nuevo)

**Ejecución de pruebas:**

```bash
node --experimental-strip-types --test tests/whatsapp-*.test.mjs tests/instagram-webhook.test.mjs
```

**Importante:** Este documento no acredita corrección del token ni de permisos externos; esas verificaciones solo pueden realizarse contra producción usando secretos resguardados.
