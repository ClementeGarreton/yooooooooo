# WhatsApp: cotización pragmática sin paso de fotografías

Estado: implementación local para despliegue. La derivación a secretaría sigue inactiva.

## Conversación

1. `COTIZAR`: envía preguntas **1–4** y espera respuesta.
2. Parsea el texto libre, fusiona respuestas con los campos de `quote_sessions.state` y envía preguntas **5–8** una vez procesada la primera respuesta.
3. Después del segundo bloque, solicita **en un mensaje conjunto** únicamente lo que falte; interpreta las aclaraciones posteriores sin borrar datos conocidos.
4. Cuando los datos necesarios están completos, muestra el **inventario** y permite `Agregar:`, `Quitar:` y `confirmar`. **No hay mensaje intermedio de fotografías ni hay que escribir `NO` o `LISTO`.**
5. Cuando se recibe una foto **en cualquier etapa activa**, se analiza y agrega al inventario. Si el artículo ya estaba contado, la foto no agrega unidades duplicadas; el cliente puede indicar explícitamente que son unidades adicionales.
6. `confirmar` genera la cotización y el PDF solo después de revisar el inventario y de que no haya fotos sin procesar o artículos pendientes de identificar.

La secretaría permanece **dormida**: no se utiliza `handoff_requests`, no se activa modo humano ni se necesita migración de tablas. El aviso de 10 minutos previamente implementado se mantiene.

## Interpretación pragmática y límites

- GPT recibe la respuesta libre, las preguntas vigentes, el estado previo y reglas semánticas para identificar el referente de la respuesta. La capa `pragmaticInference.ts` aplica reglas verificables y registra evidencia técnica sin exponerla al cliente.
- «Departamento y casa respectivamente» permite asignar los tipos de origen y destino. «Casa de un piso, sin escaleras» corresponde a carga a nivel de entrada, sin ascensor operativo. «El estacionamiento está junto a la entrada del destino» significa 0 metros **solo en destino**.
- La negación en una respuesta de cuatro líneas al bloque 5–8 se interpreta en el orden de esas cuatro preguntas; «no gracias» rechaza el servicio respectivo, no todas las opciones.
- «El camión queda cerca», «hay ascensor» sin referente y «casa» sin piso **no autorizan completar distancias, ascensor ni pisos**. Esos valores permanecen pendientes.
- Las fotografías reciben reconocimiento automático, pero si no se logra identificar un artículo se pide su descripción; no se inventa un ID ni un precio.

## Test drive dev

`node tests/whatsapp-pragmatica-sin-friccion.test.cjs`
`node tests/whatsapp-bloques-espera.test.cjs`
`node tests/whatsapp-four-messages.test.cjs`
`node tests/whatsapp-natural-language-regression.test.cjs`

Las pruebas nuevas incluyen inferencias seguras, contraejemplos y deduplicación de inventario. Se comparó con la versión anterior: ocho suites preexistentes ya fallaban en esa versión por expectativas antiguas. No se ejecutó `next build` completo porque `npm ci --offline` no pudo recuperar `zustand` del caché; el despliegue aún debe verificar tipos y servicios externos.
