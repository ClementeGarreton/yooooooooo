# Flujo WhatsApp ajustado

- **Datos:** se envían dos mensajes iniciales cortos (preguntas 1-4 y 5-8), sin «Respuesta:». Se admiten respuestas libres y respuestas numeradas.
- **Implicaturas:** el NLP recibe el estado ya guardado más las preguntas reales del último envío; entiende referencias como «en origen sí», «en destino casa, planta baja», «tampoco», sin registrar aclaraciones sobre pisos como muebles.
- **Aclaraciones:** solo los temas esenciales pendientes, agrupados en un único mensaje. Cuando el cliente no entiende una pregunta, se reformula con ejemplos, en vez de repetirla.
- **Fotos opcionales:** envío de fotografías y «LISTO», o «NO» para omitir.
- **Inventario:** mostrar, editar con «Quitar» / «Agregar» y PDF solo tras «confirmar».
- **Secretaría:** sin derivación ni dependencia de handoff_requests, tal como se pidió.

## Aviso tras 10 minutos de inactividad

No necesita nuevas tablas. El endpoint `GET /api/cron/whatsapp-idle` consulta el último mensaje del cliente y envía una sola alerta por periodo de inactividad; si el cliente responde, se reinicia el reloj.

**Para activarlo de verdad**, configura en GitHub Actions:

- `Settings > Secrets and variables > Actions > Secrets`: `CRON_SECRET` (mismo valor que en Vercel).
- `Settings > Secrets and variables > Actions > Variables`: `WHATSAPP_REMINDER_SITE_URL` (URL pública de la app, por ejemplo https://tu-proyecto.vercel.app).

El workflow incluido ejecuta el chequeo cada **5 minutos**, y por tanto el aviso llega aproximadamente entre 10 y 15 minutos después de la última actividad, sujeto a retrasos de GitHub. Si necesitas precisión de un minuto, configura un programador HTTP externo para llamar al mismo endpoint cada minuto con `Authorization: Bearer <CRON_SECRET>`.

No se ha agregado un cron subdiario a `vercel.json` para no romper despliegues en Vercel Hobby. Los dos crons diarios existentes permanecen intactos.

Pruebas locales: `node tests/whatsapp-dialogue-short.test.cjs` y `node tests/whatsapp-four-messages.test.cjs`. Prueba real de Meta/OpenAI/Supabase requerida.
