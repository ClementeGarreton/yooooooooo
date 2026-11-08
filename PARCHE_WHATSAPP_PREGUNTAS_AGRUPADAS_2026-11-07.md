# Parche: cotización agrupada por WhatsApp · 7 noviembre 2026

## Problema reproducido
Tras recibir las seis respuestas SÍ/NO el bot enviaba diez o más mensajes consecutivos, uno por cada comuna, región, piso, distancia, destino e inventario. Además repetía «Corrección registrada» y podía mostrar una ficha muy extensa.

## Cambios
- **Datos faltantes en UN solo mensaje:** se agrupan por datos generales, origen, destino e inventario, omitiendo los campos que ya están completos. El cliente responde en lenguaje natural; no necesita copiar etiquetas.
- **Preguntas SÍ/NO:** siguen reunidas en un único bloque para ascensores y servicios, incluido «NO A TODO».
- **Respuestas libres:** frases del tipo «Origen: departamento en Las Condes, 5° piso, camión a 15 metros; Destino: casa en Las Condes, 0 metros» pasan al parser multi-campo en vez de rechazarse como tipo de inmueble inválido.
- **Ambigüedad:** cuando un dato corto («5», «RM», «Las Condes») puede pertenecer a origen o destino, el bot pregunta qué significa antes de alterar el registro.
- **Interfaz:** se elimina «Corrección registrada» repetitivo; la ficha extensa solo se envía ante FICHA. Cuando todos los datos están completos se solicita CONFIRMAR o revisar FICHA.
- **Comunas RM:** al ingresar directamente ciertas comunas inequívocas (como Las Condes), se completa Región Metropolitana si aún estaba vacía. También se permite escribir RM al corregir la región.

## Archivos a reemplazar
1. `src/lib/whatsapp/freeformIntake.ts`
2. `src/lib/whatsapp/incomingProcessor.ts`
3. `src/lib/ai/whatsappQuoteAssistant.ts`

No reemplazar `vercel.json` ni las rutas de revisión de precios: no forman parte de este parche.

## Pruebas
- Node 22: `node --experimental-strip-types --test tests/whatsapp-*.test.mjs` → **99/99 aprobadas**.
- Sintaxis TypeScript de los tres archivos modificados: **sin errores de análisis**.
- **No se ha podido ejecutar** un build completo de Next.js ni una prueba de integración real con WhatsApp/Meta/OpenAI/Supabase desde este entorno; esos pasos deben hacerse en Vercel/despliegue de pruebas.

## Criterio de aceptación
Con datos personales, fecha y direcciones parciales ya guardadas, el bot debe preguntar **en el mismo mensaje** por los atributos pendientes de origen y destino y por el inventario; no debe preguntarlos uno por uno. No debe enviar una ficha completa salvo al escribir FICHA. Tampoco debe inventar qué significa un dato ambiguo.
