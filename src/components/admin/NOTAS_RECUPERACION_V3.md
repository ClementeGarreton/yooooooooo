# Panel /admin · Recuperación v3 · 7 noviembre 2026

## Qué integra

La interfaz se adaptó tomando como referencia la captura autorizada `CAPTURA_ADMIN_CHROME_HABITUAL_2026-11-07.zip` (33 estados guardados). La captura es documentación visual/HTML, **no** el repositorio original de Next.js.

- **Inicio y Por aprobar:** resumen y reservas pendientes de las API existentes; se reordena el panel de aprobación según la referencia.
- **Calendario y Trabajos:** cuadrícula mensual, historial, filtros por período y tareas de apoyo **locales** claramente identificadas.
- **Reservas y Prospectos:** conservan los componentes transaccionales existentes.
- **Marketing:** visualiza prospectos, fuentes y exportación CSV; no envía campañas ni emite cupones.
- **Clientes:** combina reservas y prospectos; conserva la cartera original de clientes atendidos como subpestaña.
- **Empresas:** agrupa servicios empresariales de reservas y permite exportar CSV.
- **Finanzas:** muestra las seis subpestañas de referencia; los resúmenes reales vienen de las API de reservas y estadísticas y se mantienen los gráficos.
- **Emisión de facturas:** prepara y exporta una base de servicios; NO emite facturas ni interactúa con el SII.
- **Flota, Horarios, Actividad y Conversaciones IA:** mantienen sus componentes originales.
- **Configuración:** conserva Precios, Horarios, Inventario y Usuarios; añade borradores locales de pagos a trabajadores y políticas.

## Límites funcionales explícitos

Los servicios externos que aparecen en el panel capturado y que no están presentes en las API de este proyecto **no se han recreado artificialmente**: aprobaciones de trabajadores, asignaciones de cuadrillas, campañas de correo, cupones, enlaces empresariales, facturas tributarias, gastos, bancos, nóminas, cierre de pagos y publicación de políticas. Las pantallas correspondientes indican el límite de forma visible. Los datos de las capturas NO se incorporan al proyecto.

Las tareas y borradores locales **no se sincronizan** con el servidor. Un borrador de política no modifica los términos públicos de la empresa.

## Alcance técnico y seguridad

Cambios limitados a `src/app/admin/page.tsx` y `src/components/admin/*`. **No se modificaron `src/app/api`, Supabase, la base de datos, las rutas de WhatsApp, pagos ni variables de entorno.** No se incluyen capturas privadas ni cookies de sesión.

## Prueba y despliegue

1. Instalar dependencias (`npm ci`) y ejecutar `npm run build`.
2. Revisar `/admin` en un deployment **Preview** de Vercel. El pie debe indicar **Panel renovado v3**.
3. Probar autenticación, carga de Inicio, Reservas, Prospectos, Clientes, Marketing, Empresas, Finanzas y Configuración antes de sustituir producción.

**Pruebas completadas localmente:** análisis sintáctico de TSX, compilación de tipos aislada para módulos nuevos y comparación de archivos fuera de `/admin`. **Prueba pendiente:** `next build` íntegro, ya que el entorno de desarrollo no tiene los paquetes de npm instalados y no puede acceder al registro de npm.
