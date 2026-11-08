# Corrección de compilación Vercel — 8 de noviembre de 2026

## Error

Build de Next.js 14.2.35 en `src/lib/ai/whatsappQuoteAssistant.ts:115`: `Expected ':', got 'numeric literal (5, 5)'`.

## Causa y cambio

Una cadena JavaScript delimitada por comillas simples incluía otras comillas simples sin escapar en las frases `5 pisos en origen` y `no hay ascensor`. Se cambiaron por comillas tipográficas `«...»`, manteniendo el texto del prompt y su significado. No se cambiaron APIs, rutas ni dependencias.

## Comprobaciones locales

- `node --experimental-strip-types --check src/lib/ai/whatsappQuoteAssistant.ts` — CORRECTO.
- Misma comprobación en `src/lib/whatsapp/tommyDifferential.ts` y `src/lib/whatsapp/tommyFlow.ts` — CORRECTO.
- `node --experimental-strip-types --test tests/*.test.mjs` — 165/165 pruebas CORRECTAS.
- `npm run build` — NO VERIFICADO localmente: no fue posible completar la instalación de dependencias del proyecto en este entorno. Volver a ejecutar la compilación en Vercel con el ZIP corregido.

Este paquete es una corrección puntual sobre `YoMeEncargo_Accesos_Ascensor_Escalera_2026-11-08.zip`. Compruebe que el commit de GitHub incluya los nuevos archivos antes del redespliegue.
