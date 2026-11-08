# Corrección integral: respuestas copiadas desde WhatsApp

## Defecto reproducido

El mensaje de Tommy contiene preguntas de 6 grupos, y el cliente puede copiarlo y escribir la respuesta **al final de cada pregunta**, incluso después de frases con «Si no hay, responde No» o «(Sí / No)». La versión anterior rechazaba estas líneas antes de interpretar la respuesta y no reconocía «escritorios» en embalaje.

Ejemplos reproducidos desde la conversación:

- `Escaleras: indícanos ... Si no hay, responde No. No no hay` → **Escaleras: NO**.
- `Distancia de carga: ¿hay que caminar ...? (Sí / No) no` → **Acarreo: NO**.
- `Embalaje: ¿necesitas que embalemos algo? Si es así, indícanos qué artículos. los 2 escritorios` → **Embalaje: SÍ (2 escritorios)**.
- También se aceptan respuestas insertadas al final del mensaje de **pendientes**, incluso si el cliente copia el saludo y la despedida.

## Modificación

- `src/lib/whatsapp/tommyFlow.ts`: segmenta pregunta y respuesta antes de interpretarla; conserva texto que el cliente sí escribió; mejora detección de embalaje por artículo.
- `src/lib/whatsapp/incomingProcessor.ts`: envía al lector con IA solamente respuestas y relato libre, sin el texto de preguntas copiadas que lo confundía.
- `tests/whatsapp-tommy-copied-question.test.mjs`: pruebas de regresión con ambas formas de responder.

No se cambia el texto definitivo de Tommy, el motor de precios, el cron, las migraciones ni las secciones del administrador.

## Comprobaciones

- `node --experimental-strip-types --test tests/whatsapp-*.test.mjs`: **119/119 aprobadas** en el entorno de trabajo.
- Los dos archivos TS modificados superaron una revisión de sintaxis con TypeScript.
- **Pendiente:** `npm run build` completo y ensayo real con el webhook de WhatsApp, ya que no hay una instalación íntegra de dependencias de Next.js en este entorno.

**No sustituir la versión de producción sin probar el build y una conversación real en un despliegue de prueba.** Si vuelve a pedir un campo ya respondido, conservar el texto exacto que lo provocó como nuevo caso de regresión.
