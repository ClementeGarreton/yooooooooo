# YoMeEncargo — actualización solicitada por Tommy (7 de noviembre de 2026)

Proyecto Next.js/TypeScript completo, construido sobre la versión de trabajo más reciente de YoMeEncargo (no es un prototipo nuevo).

## Cambios implementados

1. **Menú inicial:** «COTIZAR» o «ASESOR», sin «Salir» como entrada principal.
2. **Conversación natural:** respuestas iniciales más breves, directas y sin insistir en la tecnología del asistente; no se debe engañar al cliente si pregunta por su naturaleza automatizada.
3. **Preguntas agrupadas:** servicios complementarios consultados juntos con sí/no; detalles cuando corresponden.
4. **Mensajes abreviados:** bienvenida, solicitud de servicios, continuación y avisos de sesión más concisos.
5. **Retomar cotización:** la inactividad ya no borra el registro de cotización a los cinco minutos. La autorización del bot queda inactiva tras 24 horas, pero el registro sigue guardado. «RETOMAR» o «COTIZAR» reabre el trabajo previo; «NUEVA COTIZACIÓN» abre otra.
6. **Tarifas globales editables:** en Administración > Configuración de precios, valores por km, m³, embalaje, desarmado, armado y desembalaje. La web vuelve a consultar los valores vigentes; el motor compartido de web/WhatsApp incluye embalaje.
7. **Precios estimativos y revisión humana:** cliente ve valor sujeto a revisión. En Prospectos, la secretaria puede inspeccionar la cotización y cambiar tarifas **solo para ese caso**, ver el recálculo, registrar justificación y mantener la opción preexistente de ajustar el **importe total**. Un PDF anterior se invalida tras la revisión para que no se reutilice como precio vigente.
8. **Motivo de atención:** el canal de asesor recoge motivo de reclamo, seguimiento de presupuesto, trabajo en curso o problema de cotizador.
9. **Identificación:** número telefónico del contacto desde WhatsApp, identificación y número de cotización si existe; no se pide repetir el teléfono que ya recibe el canal.
10. **Secretaría:** cola de derivaciones dentro de la sección de Prospectos del panel admin; conserva contacto, motivo, detalle y estado parcial de cotización; permite marcar como atendida.

**Fuera de este encargo:** publicación del dominio e integración realizada por Francisco y decisiones internas sobre mantenimiento futuro.

## Instalación/entrega

1. Usar las variables de entorno propias del servidor. El archivo `.env.example` es solo una plantilla. **No se entregan credenciales**.
2. Ejecutar en la base de datos del proyecto, con permisos adecuados, estas migraciones: `database/migrations/20261107_handoff_requests.sql` y `database/migrations/20261107_quote_price_review.sql`.
3. En el servidor de integración: `npm ci`, `npm run build` y `npm test`. Confirmar que las rutas nuevas se publican con el middleware/autenticación ya existente.
4. Validar con una cotización real de prueba: cambiar tarifas en admin; cotizar desde web y WhatsApp; interrumpir y retomar; solicitar ASESOR; ver antecedentes en Prospectos; recalcular solo un componente, luego ajustar el total manualmente.
5. Francisco efectúa la integración/publicación en `yomeencargo.cl` después de validar.

## Comprobaciones en este entorno

- 16 pruebas automatizadas de flujo WhatsApp existentes **aprobadas** con Node `--experimental-strip-types`.
- Sintaxis de los archivos TypeScript modificados comprobada mediante transpilación.
- **No se pudo ejecutar un build completo** porque la instalación de dependencias (`npm ci`) quedó bloqueada por falta de acceso a paquetes; es obligatoria la validación en el entorno de despliegue.
- No se desplegó a producción ni se migró una base de datos real desde este entorno.

## Nota sobre la revisión por cotización

El editor de tarifas por cotización requiere que `quote_prospects.quote_state` tenga el inventario/variables del presupuesto. Para prospectos antiguos sin ese estado, queda disponible el ajuste manual del precio total. Los cambios de precio global rigen **nuevas cotizaciones/recalculaciones**, no alteran retroactivamente los importes guardados sin revisión.
