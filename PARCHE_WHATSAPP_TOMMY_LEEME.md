# Corrección definitiva de los flujos WhatsApp — YoMeEncargo

## Qué cambia

1. Menú principal: COTIZAR, RECLAMO, SEGUIMIENTO, TRABAJO, ASESOR. Estas opciones derivan directamente y registran el motivo de la solicitud en `handoff_requests`.
2. Seis decisiones sí/no en un único bloque: ascensor origen/destino; embalaje, desarmado, armado, desembalaje. El mensaje **NO A TODO** responde NO a estas seis preguntas, sin inventar pisos, distancias ni muebles. También admite enviar las seis líneas con etiquetas y especificar muebles para servicios afirmativos.
3. Tras interpretar una descripción libre, el bot pide solo los datos faltantes. La ficha extensa se muestra únicamente cuando el cliente escribe FICHA.
4. Se evita interpretar un SÍ/NO solitario como respuesta a varias preguntas.

## Integración

- **Parche puntual:** reemplazar los cuatro archivos en `src/lib/whatsapp/` por los de este ZIP, respetando las rutas. No mezclar con versiones anteriores del ZIP.
- **Proyecto completo:** alternativa ya integrada sobre el último archivo corregido de cron y registro de auditoría.
- Mantener migraciones de BD incluidas en la entrega anterior. En particular, `handoff_requests` debe existir en Supabase.
- Hacer commit en GitHub; el deploy en Vercel queda a cargo del equipo.
- Probar con una cotización nueva y con RECLAMO/SEGUIMIENTO/TRABAJO desde WhatsApp.

## Validación local

92 pruebas de WhatsApp aprobadas usando Node 22 con `--experimental-strip-types`, incluyendo cinco casos nuevos de aceptación de Tommy. Los cuatro archivos TypeScript modificados pasaron validación sintáctica. **No se realizó un build Next.js completo ni pruebas reales contra WhatsApp/Supabase** porque las dependencias y los servicios no están disponibles en este entorno. 
