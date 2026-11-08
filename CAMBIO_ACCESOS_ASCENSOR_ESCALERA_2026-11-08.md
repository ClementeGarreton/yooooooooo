# Corrección de acceso: escalera / ascensor — 8 de noviembre de 2026

## Problema
El bot preguntaba por escaleras sin diferenciar piso, ascensor apto para muebles y necesidad real de transporte por escaleras. Una respuesta parcial como «5 pisos en origen» era descartada y la pregunta se repetía sin reconocer el antecedente.

## Cambios
- Mensaje inicial número 4 reformulado para preguntar si hay ascensor utilizable en origen y destino y, solo si se usan escaleras, qué muebles y cuántos pisos.
- Mensaje de pendientes contextual: conserva «5 pisos en origen» como antecedente parcial; pregunta por acceso faltante sin exigir de nuevo esos pisos.
- Se distingue «no hay ascensor» de «no hacen falta escaleras».
- Si la IA extrae ascensor utilizable en ambos inmuebles, el acceso queda completo aunque no exista una respuesta manual a «escaleras».
- Se conserva compatibilidad de extracción diferencial con textos del formulario anterior.
- Una respuesta sobre ascensores deja de saltarse la interpretación de IA, para que los datos de acceso puedan llegar a la ficha y al precio.

## Pruebas
153/153 aprobadas con:

`node --experimental-strip-types --test tests/whatsapp-*.test.mjs`

También superada la comprobación de sintaxis de los tres archivos TS editados.

## Validación antes de producción
No se hizo `npm run build` porque este entorno no tiene `node_modules` instalados ni las credenciales del proyecto, y no hay conexión real a WhatsApp, Supabase ni OpenAI. No se desplegó nada.

Instalar dependencias y ejecutar `npm run build` en rama de pruebas. Probar conversación real y revisar ficha y precio: 1) respuesta parcial «5 pisos en origen», 2) respuesta «no hay ascensor en origen», 3) respuesta «hay ascensor en origen y destino», 4) «una cama por escalera en origen, 5 pisos», 5) formulario completo copiado sin respuestas.

**No subir este ZIP directamente a producción sin build y prueba de webhook.**
