# Entrega: respuestas ancladas a la pregunta — 8 noviembre 2026

**Qué cambia:** los 6 puntos del formulario y los pendientes incluyen `| Respuesta:`. El cliente copia el mensaje y escribe después de ese rótulo, sin borrar la pregunta. Un mensaje sin respuestas nuevas no altera la ficha.

**Interpretación:** primero separa por el número o etiqueta del campo; después lee directamente lo que siga a `Respuesta:`. Solo si el cliente utiliza el formulario antiguo emplea alineación diferencial para obtener las adiciones. Las respuestas no inferibles quedan pendientes.

**Resiliencia:** si falla la API del intérprete o el parser de inventario, el servidor conserva las respuestas de servicios verificables, registra el texto original del cliente para revisión humana y evita solicitar otra vez todo el formulario. La derivación depende de que Supabase y la tabla `handoff_requests` funcionen.

**Pruebas realizadas:** `node --experimental-strip-types --test tests/whatsapp-*.test.mjs` — 146/146 aprobadas. Comprobación de sintaxis de 4 archivos TS modificados superada.

**Pendiente antes de producción:** instalar dependencias, ejecutar `npm run build` y probar webhook real/DB/OpenAI en entorno de pruebas. La instalación falló por limitaciones de este entorno; **no se ha completado el build ni desplegado**.

**Despliegue:** instalar en una rama de pruebas, comprobar `vercel.json` (crons Hobby diarios) y migraciones ya documentadas; después verificar con un formulario completo editado, una copia sin respuestas, una respuesta parcial y una caída simulada del parser. No reenviar mensajes de clientes reales durante pruebas.
