# YoMeEncargo — Flujo aprobado por Tommy

Fecha: 2026-11-07. Base: última versión completa `YoMeEncargo_Proyecto_Completo_Agrupado_2026-11-07.zip`.

## Lo implementado

1. **Bienvenida de tres opciones numeradas**, sin «Salir»: 1 Cotizar, 2 Seguimiento, 3 Ejecutivo/proveedores/solicitudes especiales.
2. **Cotización en un solo mensaje de seis grupos**: direcciones, artículos, fecha, escaleras, distancia de carga y embalaje. Contiene una instrucción para copiar y responder el mensaje.
3. **Pendientes**: identificar y solicitar solamente los grupos incompletos en un único mensaje. «No» es distinto de no haber respondido.
4. **Agrupación de sí/no**: permitir responder escaleras, acarreo y embalaje juntos, sin exigir los 17 campos internos; cuando hay escaleras o embalaje, solicitar detalles pertinentes.
5. **Cotización a revisión**: conservar el expediente, intentar calcular valor preliminar con las tarifas vigentes del panel y registrarlo en `handoff_requests` con el contexto. No inventar nombre, correo, hora ni emitir PDF definitivo cuando faltan datos internos. La cifra preliminar puede requerir corrección por accesos y acarreo; **no es precio confirmado**.
6. **Revisión manual de secretaría**: desde Prospectos → Derivaciones se ven el caso, el precio estimativo, las variables y un editor de ajustes (+/- CLP por distancia, volumen, embalaje, escaleras y otros; o un total manual), con observación e historial básico. Estos ajustes son de la cotización, no modifican tarifas globales.
7. **Seguimiento/Ejecutivo**: textos entregados por Tommy y recolección del contexto en la bandeja de derivaciones; si en seguimiento falta correo se solicita, conservando los mensajes ya entregados.
8. **Persistencia**: el bot no borra la cotización por minutos de inactividad. RETOMAR continúa la sesión, Cotizar crea otra nueva después de que la anterior ya fue entregada a secretaría.
9. **Administración de tarifas globales**: se conserva la función previa para kilómetros, metros cúbicos, embalaje, desarmado y armado; los cálculos nuevos usan `readPricingConfig`.
10. **Vercel Hobby**: el archivo `vercel.json` conserva los cron diarios, sin tareas horarias.

## Decisiones explícitas para evitar contradicciones

- El cliente **solo ve seis grupos**, aunque la base tenga más atributos.
- **No se genera automáticamente una cotización formal definitiva** con datos faltantes; se envía a revisión. Secretarías y tarifas no se inventan.
- Los expedientes que no tienen nombre y correo no se insertan a la fuerza como `quote_prospects`: esta tabla exige nombre y correo. La bandeja «Derivaciones» dentro de Prospectos guarda esos casos hasta obtener los datos necesarios.
- El editor independiente de *textos del chatbot* no se implementa, porque Tommy lo calificó de interesante pero no indispensable y no se acordó el alcance ni permisos de edición.
- Los cambios de precio de un expediente por concepto son **ajustes manuales en pesos**, no recálculos de tarifa por unidad. El panel global y `ProspectPriceReview` siguen disponibles para las revisiones tarifarias existentes.
- **No se envían automáticamente precios revisados al cliente** desde la bandeja de derivaciones: comunicar el precio definitivo es tarea de secretaría.

## Integración y validación pendiente

1. Respaldar proyecto y base de datos antes de publicar.
2. Comprobar que las migraciones previas estén aplicadas, en especial `database/migrations/20261107_handoff_requests.sql` y `database/migrations/20261107_quote_price_review.sql`.
3. En un entorno con conexión y dependencias disponibles: `npm ci`, `npm run build`; revisar errores TypeScript y lint antes del despliegue.
4. Ejecutar `node --experimental-strip-types --test tests/whatsapp-*.test.mjs` y los demás tests del repositorio.
5. Probar en un número WhatsApp de ensayo: bienvenida 1/2/3, bloques completos e incompletos, fotos, RETOMAR, derivaciones, edición manual y privacidad de admin. **No se ha hecho prueba de extremo a extremo en WhatsApp real ni en Supabase real.**
6. Francisco se encarga de la publicación definitiva y la integración en `yomeencargo.cl`.

## Validación realizada aquí

- 115 pruebas del código de WhatsApp ejecutadas con Node 22: 115 aprobadas, 0 fallidas.
- Archivos TypeScript nuevos y modificados analizados para sintaxis/transpilación.
- No se pudo completar `npm ci` ni el build de Next.js en este entorno; **la compilación de producción sigue sin verificar**. No publicar sin superar este paso.
