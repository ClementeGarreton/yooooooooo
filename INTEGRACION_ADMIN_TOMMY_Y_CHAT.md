# Integración de administración — UX/UI Tommy + funciones conversacionales

## Resultado

**Base visual:** copia completa de `cotizador-mudanzas-main.zip` (6–7 nov 2026).
Se conservan `src/app/admin/page.tsx` (tablero, calendario, reservas, trabajos, prospectos, clientes, empresas, facturación, finanzas, flota, actividad y ajustes), componentes de interfaz, API de operaciones y esquema de roles del template.

**Módulo añadido al menú nativo:** `Ventas → Conversaciones IA`.
- Lista filtrable y detalle de conversaciones WhatsApp, Instagram y web.
- Auditoría de mensajes, sesiones, acciones, fotografías de inventario y costes registrados.
- Comprueba si existe la configuración de WhatsApp (sin exponer secretos).
- Protegido por sesión administrativa y por el candado `ai-conversations` del editor de perfiles.

**Motor recuperado de nuestra versión conversacional:** webhook firmado, verificación de número autorizado, enrutador/bienvenida, soporte de varios canales, parsing de declaración libre, ficha de cotización, edición de inventario, fotos, PDF y canal de Instagram. Se conservan los componentes comerciales y contables del template.

## Aspectos que requieren comprobación antes de publicar

1. **No desplegar directamente a producción.** Crear rama/despliegue *Preview* para probar con una base clonada o datos de prueba; evitar mezclar estados de cotización y tablas en producción sin comparar el esquema real de Supabase.
2. **Base de datos:** verificar que `ai_conversations`, `ai_messages`, `ai_actions`, `quote_sessions` y su índice único existen. La migración incluida es referencia; no ejecutarla repetida o a ciegas. El template incluía otra variante `database/add_ai_conversations_and_quote_sessions_CORREGIDO.sql`: comparar con el esquema antes de aplicar cualquiera.
3. **Variables:** conservar desde el despliegue anterior `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET`, `OPENAI_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; `WHATSAPP_SECRETARY_PHONE_NUMBER_ID` solo si es necesario. Los secretos no están incluidos en este ZIP.
4. **Autorización:** a los perfiles preexistentes se les hereda la visibilidad de `Conversaciones IA` de `Prospectos`; en nuevos perfiles es una casilla específica. Revisar asignaciones antes de exponer datos personales de conversaciones.
5. **Pago / presupuesto:** verificar con prueba end-to-end del flujo de 7 secciones, cálculo de precio, PDF, webhook entrante y respuestas enviadas. No hay conexión en este entorno a Meta/Supabase/Vercel para confirmar el comportamiento real.

## Validación realizada aquí

- **556 archivos TS/TSX**: 0 errores sintácticos al transpilar con TypeScript.
- **91 pruebas de WhatsApp/Instagram y conversación:** 91 aprobadas usando `node --experimental-strip-types --test tests/*.test.mjs`.
- **Imports locales**: 0 rutas `@/` o relativas sin archivo de destino (comprobación estática).
- **Compilación Next.js completa no ejecutada:** instalación de dependencias sin conectividad estable en este entorno. No se validó la conexión real a Supabase, Meta, OpenAI ni Vercel.
- No hay credenciales reales incluidas en el paquete. Se excluyeron los `node_modules` parcialmente instalados.

## Prueba de integración local

```bash
npm ci
npm run build
npm test
```

Usar `.env.local` propio para *Preview*; **nunca compartir tokens en capturas o repositorios**.

## Cambios principales
- `database/migrations/add_ai_conversations_and_quote_sessions.sql`
- `src/app/admin/page.tsx`
- `src/app/api/admin/ai-conversations/[id]/route.ts`
- `src/app/api/admin/ai-conversations/route.ts`
- `src/app/api/admin/ai-conversations/summary/route.ts`
- `src/app/api/instagram/webhook/route.ts`
- `src/app/api/whatsapp/webhook/route.ts`
- `src/components/admin/AdminSidebar.tsx`
- `src/components/admin/AiConversations.tsx`
- `src/lib/adminAccess.ts`
- `src/lib/adminModules.ts`
- `src/lib/ai/conversationStore.ts`
- `src/lib/ai/openai.ts`
- `src/lib/ai/prompts.ts`
- `src/lib/ai/whatsappQuoteAssistant.ts`
- `src/lib/instagram/splitText.ts`
- `src/lib/instagram/webhookPayload.ts`
- `src/lib/quoteSession.ts`
- `src/lib/whatsapp/botRouter.ts`
- `src/lib/whatsapp/botStateStore.ts`
- `src/lib/whatsapp/cloudApi.ts`
- `src/lib/whatsapp/extrasFlow.ts`
- `src/lib/whatsapp/freeformIntake.ts`
- `src/lib/whatsapp/incomingProcessor.ts`
- `src/lib/whatsapp/inventoryEdits.ts`
- `src/lib/whatsapp/inventoryResolution.ts`
- `src/lib/whatsapp/messageTransport.ts`
- `src/lib/whatsapp/photoStorage.ts`
- `src/lib/whatsapp/propertyFlow.ts`
- `src/lib/whatsapp/taxDocument.ts`
- `src/lib/whatsapp/webhookDiagnostics.ts`
- `tests/instagram-webhook.test.mjs`
- `tests/whatsapp-bot-router.test.mjs`
- `tests/whatsapp-extras-flow.test.mjs`
- `tests/whatsapp-freeform-intake.test.mjs`
- `tests/whatsapp-integral-contract.test.mjs`
- `tests/whatsapp-inventory-edits.test.mjs`
- `tests/whatsapp-inventory-integrity.test.mjs`
- `tests/whatsapp-inventory-low-friction.test.mjs`
- `tests/whatsapp-openai-robustness.test.mjs`
- `tests/whatsapp-property-flow.test.mjs`
- `tests/whatsapp-tax-document.test.mjs`
- `tests/whatsapp-webhook-diagnostics.test.mjs`

### Observaciones de integración

El ZIP original de Tommy contiene un registro de módulos y perfiles más reciente que las versiones que desarrollamos. Por eso **se preservó su código de reservas, pagos y cálculo de tarifas**. Las fotos del inventario, boleta/factura y metros de acarreo se añadieron al PDF sin sustituir la fórmula de precios del original.

El módulo de CRM recuperado es el disponible en la copia de conversación (`YoMeEncargo_Chat_Conversacional.zip`). No se han afirmado incorporados otros controles comerciales de versiones posteriores cuyo código fuente no estuviera en los archivos disponibles.
