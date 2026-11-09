# Flujo WhatsApp actualizado — 9 de noviembre de 2026

1. **Dos mensajes iniciales:** preguntas 1–4 y 5–8. Sin «Respuesta:». El cliente escribe libremente; el NLP interpreta respuestas e implicaturas y las almacena en `quote_sessions.state`.
2. **Solo lo que falte:** una única repregunta agrupada por temas (máximo siete bloques, nunca 23 comprobaciones separadas). Si el cliente no entiende algo, GPT parafrasea la pregunta según su contexto; conserva lo que ya contestó.
3. **Fotos opcionales:** puede enviar fotos y escribir «LISTO», o «NO» para omitir.
4. **Inventario y PDF:** mostrar artículos, aceptar «Quitar» / «Agregar» y emitir PDF únicamente tras «confirmar».

La derivación a secretaría sigue dormida, sin migración de DB. Se añadió un aviso tras 10 minutos de inactividad; **requiere programar** la ruta HTTP con las instrucciones de `FLUJO_WHATSAPP_CORREGIDO_2026-11-09.md`.
