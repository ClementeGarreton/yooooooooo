# Actualización controlada de OpenAI — cotizador WhatsApp

## Qué cambia
- Modelo predeterminado: `gpt-6.1-terra` (antes `gpt-5.6-luna`).
- Razonamiento de los dos parsers de WhatsApp: `medium` (antes `none`).
- Límite de salida total (incluye razonamiento): 6000 tokens para interpretación general; 4000 para inventario y fotografías. No es un consumo obligatorio.
- Estimación de costo interno actualizada para Terra y Luna.
- No se modifica el menú, los seis grupos, las tarifas, el panel ni la lógica de derivación.

## Configuración necesaria en Vercel
En **Project Settings > Environment Variables** (entorno de producción / preview según corresponda):

    OPENAI_MODEL=gpt-6.1-terra
    OPENAI_REASONING_EFFORT=medium

Si `OPENAI_MODEL` seguía definido con un modelo anterior, ese valor ANULA el predeterminado del código. Reconfigurarlo y hacer un despliegue nuevo.

**Opcional**: probar `OPENAI_REASONING_EFFORT=high` en Preview si medium no mejora las evaluaciones. Subir esfuerzo también puede aumentar tiempo y costo. No usar `high` sin pruebas comparativas.

## Costo y acceso
- Tarifa estándar GPT-6.1 Terra: USD 1 por millón de tokens de entrada y USD 5 por millón de tokens de salida, según documentación pública de OpenAI consultada el 7 de noviembre de 2026.
- El gasto exacto depende de los tokens, incluido el razonamiento, y del modelo realmente configurado en Vercel.
- No se ha consultado el saldo real de la cuenta del usuario ni se han realizado llamadas con su API key.

## Verificaciones efectuadas
- `node --experimental-strip-types --test tests/*.test.mjs`: **149/149**.
- Nuevas pruebas de petición a OpenAI: modelo, reasoning effort, override de Vercel, límites, JSON schema, estimación de costo.

## Antes de publicar
- `npm ci` y `npm run build` sobre el proyecto en un entorno con dependencias disponibles.
- Probar con el mismo mensaje mal escrito del usuario y con un formulario copiado sin modificaciones; verificar en la bandeja de prospectos que no se inventan datos.
- Confirmar que la API key tiene acceso a `gpt-6.1-terra` y vigilar costo/latencia.
- El `npm ci` en este entorno superó el tiempo disponible; la compilación completa NO está verificada.
