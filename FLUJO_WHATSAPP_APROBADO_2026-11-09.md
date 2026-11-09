# WhatsApp: flujo aprobado (9 de noviembre de 2026)

El bot sigue cuatro etapas, sin migrar la base de datos:

1. Mensaje original de ocho preguntas con «Respuesta:» (exactamente el texto aprobado).
2. Si hay datos pendientes del QuoteStore, los solicita **todos juntos**, cada uno con «Respuesta:». Interpreta texto libre y copia del formulario, consolida en `quote_sessions.state` y nunca borra respuestas ya guardadas. Incluye RUT personal y distingue `No`, `0` y campo desconocido.
3. Solicitud de fotos opcionales. Se envían fotos para reconocer muebles, o `NO` para pasar sin fotos. Después de enviar fotos se escribe `LISTO`.
4. Inventario obtenido de texto y fotos. Admite `Quitar:` y `Agregar:` (múltiples artículos). **Solo** `confirmar` en esta etapa permite precio y PDF.

El catálogo existente sigue siendo la fuente de volúmenes y pesos, y el motor de precios vigente es el que calcula la cotización. No se requiere migración nueva: `quoteFlowVersion` y `quoteFlowStep` viven en el JSONB `quote_sessions.state.intake`. Sesiones anteriores se actualizan al retomarlas con `COTIZAR` o `RETOMAR`.

## Secretaría

La derivación automática queda en pausa. Los comandos de asesor/reclamo/seguimiento no cambian el modo a `human`, no cierran la cotización y no consultan `handoff_requests`. Esta tabla continúa sin requerirse en producción.

## Verificación

- Prueba pura: `node tests/whatsapp-four-messages.test.cjs`.
- Sintaxis TypeScript revisada en los seis archivos intervenidos.
- **Pendiente**: `npm ci && npm run build` y prueba real con Supabase, WhatsApp Cloud API y OpenAI. La instalación de dependencias del contenedor no se completó porque faltaron paquetes en la caché y el registro npm no respondió.
