# Yo Me Encargo — Flujo contrato-guía → relato → ficha → ajustes → cotización

Implementación sobre `YoMeEncargo_Admin_Tommy_Fusion.zip` (base disponible el 7 de noviembre de 2026). No es un despliegue ni sustituye una versión más nueva que no se haya incorporado al ZIP.

## Comportamiento

1. El cliente escribe **COTIZAR**. Recibe un contrato-guía informativo de 7 apartados, sin compromiso contractual ni reserva.
2. Responde con relato libre (puede ser circunlocución), o rellena las cláusulas copiadas. El parser IA extrae todos los datos explícitos; no rellena desconocidos.
3. Recibe **una ficha interpretada completa**, con nombres exactos de variables, inventario y pendientes. La ficha se puede solicitar más adelante con **FICHA**.
4. El bot formula solo **un pendiente por mensaje**, sin repetir toda la ficha. Se aceptan respuestas cortas inequívocas (`sí`, `5`, `boleta`, etc.), correcciones `CAMPO: VALOR`, varios campos en bloque y párrafos naturales.
5. Si hay una inconsistencia, no modifica datos parcialmente. Las correcciones de muebles se contrastan con el catálogo, y el cálculo respeta el módulo de precios existente.
6. Solo **CONFIRMAR** con ficha completa e inventario validado genera precio y PDF. `ASESOR` y `SALIR` mantienen el enrutamiento anterior.

## Archivos afectados

- `src/lib/whatsapp/freeformIntake.ts`: contrato-guía, pendientes uno por uno, interpretación contextual de respuestas breves, reconocimiento de respuestas por cláusulas.
- `src/lib/whatsapp/incomingProcessor.ts`: revisión inicial completa, revisiones posteriores concisas, comando FICHA, respuestas contextuales y envío seguro de borradores por cláusulas al parser.
- `src/lib/ai/whatsappQuoteAssistant.ts`: contexto del dato puntual preguntado para interpretar respuestas breves con la IA.
- `tests/whatsapp-contract-refinement.test.mjs`: regresión del nuevo comportamiento.

## Instalar sin destruir la versión actual

El ZIP `Parche_Flujo_Contrato_WhatsApp.zip` conserva las rutas relativas. Copiar su contenido **sobre una rama de pruebas** de la base original, no sobre producción de inmediato. Mantener `.env.local` fuera del repositorio.

Después de instalar dependencias con `npm ci`, ejecutar `npm test`, `npm run build` y probar un chat real en ambiente de pruebas. El flujo WhatsApp solo se activa con **COTIZAR** y sigue requiriendo los secretos existentes de Supabase/Meta. No necesita migración SQL.

## Validación realizada

- 98 pruebas de Node (`node --experimental-strip-types --test tests/*.mjs`) aprobadas.
- Transpilación sintáctica de archivos TS/TSX verificada.
- **No** se pudo verificar compilación integral de Next.js ni integración real con Meta/Supabase porque en este entorno no se instalaron dependencias ni se utilizaron credenciales.

## Casos manuales recomendados

- Relato largo con fecha, dos direcciones, pisos/ascensor, inventario, servicios y boleta.
- Corregir `PISO ORIGEN SI APLICA: 5` y responder `sí` al ascensor cuando esté pendiente.
- Copiar cláusulas `1. Solicitante: ...` hasta `7. Observaciones: ...` y confirmar que se parseen.
- Inventario: `quitar refrigerador y añadir otra cama matrimonial` (debe resolverse como cama de dos plazas cuando el catálogo la contiene).
- Intentar `CONFIRMAR` con pendientes; nunca debe generar el PDF.
