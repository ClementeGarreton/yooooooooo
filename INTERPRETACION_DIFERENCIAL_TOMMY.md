# Cierre — intérprete diferencial de formularios WhatsApp

## Qué cambia

El cliente puede copiar íntegro el formulario de seis preguntas, editarlo a su manera y devolverlo aunque cometa faltas de ortografía, reordene signos o responda de forma coloquial.

1. `src/lib/whatsapp/tommyDifferential.ts` toma como referencias el formulario original y las preguntas de pendientes; alinea palabras comunes (LCS) y recupera adiciones, sustituciones y elecciones Sí/No hechas eliminando alternativas.
2. `src/lib/whatsapp/tommyFlow.ts` utiliza únicamente las diferencias para determinar las respuestas de escaleras, acarreo y embalaje. No extrae valores del texto fijo del formulario.
3. `src/lib/whatsapp/incomingProcessor.ts` manda únicamente los cambios a la IA que interpreta direcciones, inventario y fecha; nunca vuelve a mandar a la IA la plantilla intacta. Los campos contradictorios se consultan sin asumir respuestas.
4. El comportamiento antiguo para mensajes libres sin formulario se conserva.

## Restricciones deliberadas

- «Sí» para escaleras NO basta: debe especificar artículos, cantidad de pisos y lugar.
- «Sí» para acarreo NO basta: falta el lugar (origen, destino o ambos) o una distancia informativa.
- «Sí» para embalaje NO basta: debe identificar qué se embala.
- Si copia un mensaje sin modificarlo, sigue pendiente: una pregunta no es una respuesta.
- Si escribe respuestas contradictorias para el mismo campo, se pide aclaración.
- Para fechas, inventario y direcciones, el intérprete diferencial solo extrae el texto cambiado; la interpretación semántica sigue siendo responsabilidad del parser existente conectado a IA y del catálogo del negocio.

## Pruebas

Ejecutadas en este entorno:

`node --experimental-strip-types --test tests/*.test.mjs`

Además se verificó la sintaxis TypeScript de los tres archivos modificados y se validó aisladamente el módulo diferencial con `tsc`.

**Límite importante:** en este entorno no fue posible instalar las dependencias de Next.js. El proyecto completo NO se ha compilado con `npm run build` ni probado contra la base de datos o WhatsApp reales.

## Antes de producción

1. `npm ci`
2. `npm run build`
3. `node --experimental-strip-types --test tests/*.test.mjs` (Node 22)
4. Usar un despliegue de prueba y enviar una copia del formulario con errores y respuestas antes de reemplazar producción.

El cron diario de Vercel Hobby permanece sin cambios.
