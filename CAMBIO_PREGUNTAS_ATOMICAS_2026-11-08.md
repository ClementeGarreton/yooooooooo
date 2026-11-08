# Corrección — Preguntas de acceso separadas (8 noviembre 2026)

## Problema
El recordatorio anterior combinaba ascensores en dos inmuebles, necesidad de escaleras, muebles y pisos en una misma pregunta. Una respuesta «Sí» podía resultar ambigua.

## Comportamiento corregido
Cuando falta información de acceso, se muestran preguntas numeradas independientes:
- `4.1)` Ascensor utilizable en origen: Sí/No.
- `4.2)` Ascensor utilizable en destino: Sí/No.
- `4.3)` Necesidad de escaleras en origen: Sí/No.
- `4.4)` Necesidad de escaleras en destino: Sí/No.
- Solo si se confirma el uso de escaleras, `4.5)` qué muebles; `4.6)` pisos origen (si aplica); `4.7)` pisos destino (si aplica).

Cada línea termina con `| Respuesta:` para copiar y completar. Nunca se interpreta el «Sí/No» dentro de la pregunta como respuesta del cliente.
Las respuestas se guardan de manera independiente en `quote_sessions.state.intake.tommyAccess`; no hay migración SQL.
Las respuestas de acarreo y embalaje siguen procesándose cuando se envían en el mismo mensaje.

## Pruebas
`node --experimental-strip-types --test tests/whatsapp*.test.mjs`
154/154 aprobadas. Las pruebas nuevas cubren copias intactas, respuestas parciales, respuestas negativas, preguntas condicionales y campos mezclados.
Se verificó sintaxis de los cuatro archivos TypeScript afectados. No se hizo build integral de Next.js ni prueba del webhook con WhatsApp y Supabase reales.

## Despliegue
1. Preservar secretos y variables ambientales del servidor existente.
2. Realizar `npm ci && npm run build` en el entorno que tenga las dependencias del proyecto.
3. Publicar primero en vista previa y probar una copia del formulario, una respuesta parcial y las cuatro preguntas binarias. Confirmar que un «Sí» no complete otros campos.
4. Promover únicamente si las pruebas reales funcionan. No requiere modificar tarifas ni bases de datos.
