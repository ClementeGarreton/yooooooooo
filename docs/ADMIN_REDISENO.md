# Rediseño del panel: un solo sistema

Rama `feat/admin-rediseno`, que parte de `feat/perfil-del-cliente` (PR #6). Sale en su
propio PR: el panel de perfiles se puede probar y fusionar sin esperar esto.

## Pedido de Francisco (03-10-2026)

«Ahora es un software serio»: rediseñar la interfaz completa, copiando cómo funciona
Ordenox hoy — usuarios con permisos, menú a la izquierda en vez de arriba, igual que el
panel del cliente, «casi que unificar todo en uno». Y que los clientes atendidos tengan
cuenta automáticamente.

## Decisiones (Francisco, 03-10-2026)

- **Mismo diseño, tres entradas.** Admin (`/admin`), cliente (`/mi-cuenta`) y trabajador
  (`/trabajos`) comparten barra lateral, colores y componentes, pero cada uno entra por su
  puerta con su propia sesión. Es como Ordenox: sistema y portal del cliente separados.
- **Acceso de clientes: RUT la primera vez + clave propia.** Entra con correo + RUT solo
  la primera vez y ahí crea su clave. El link al correo sigue existiendo para quien no
  tiene RUT guardado y para recuperar la clave. Hoy solo se guarda el RUT de EMPRESAS
  (`company_rut`); a las personas el cotizador no se lo pide: hay que empezar a pedirlo.
- **Rama nueva** sobre la actual.

## Qué se copia de Ordenox

Leído en `~/AI/Clientes/Applefix/ordenox` (solo lectura) el 03-10-2026:

- **Un registro único de módulos** (`application/config/permisos_modulos.php`): una
  entrada por ítem del menú lateral, en el mismo orden. De ahí salen el menú, el editor de
  permisos y el candado por URL.
- **Perfiles con interruptores** (`Permission.php` + `Permisos_modulos.php`): cada usuario
  tiene un perfil; el perfil enciende o apaga cada módulo y, dentro, acciones sueltas
  (crear, editar, borrar, acciones delicadas). Un módulo apagado no aparece en el menú y
  no se abre aunque se teclee la dirección.
- **Portal del cliente con clave** (`Conecte.php`): el cliente entra con su usuario y
  clave, ve lo suyo y puede cambiar su clave.

## Fases

1. **Menú lateral y registro de módulos — HECHO** (`f482150`). `src/lib/adminModules.ts`
   es el registro; `src/components/admin/AdminSidebar.tsx` el menú, agrupado en Operación,
   Ventas, Clientes, Equipo y Sistema. El contenido de cada sección todavía es el actual.
2. **Perfiles con permisos — HECHO** (`6b77f71`). **Requiere correr
   `database/migrations/add_admin_profiles.sql`** (aditiva; se puede correr antes de
   fusionar, el código de producción no la nota). Sin ella todo sigue con los dos roles.
   - **Qué hace la migración:** crea «Administrador» (todo, no editable) y «Secretaría»
     (todos los módulos, sin acciones delicadas) y le pone a cada usuario el que
     corresponde a su rol de hoy. Nadie gana ni pierde nada.
   - **Modelo** (`src/lib/adminModules.ts`, `src/lib/adminAccess.ts`): un interruptor por
     módulo del menú; Inicio siempre encendido. Tres acciones delicadas aparte, que solo
     valen con su módulo encendido: usuarios y perfiles, cupones y referidos (en
     Configuración) y emitir facturas (en Empresas). Son las tres cosas que hoy hace solo
     el Administrador.
   - **Menú:** esconde los módulos apagados (`/api/admin/auth/me` devuelve el acceso).
   - **Servidor** (`src/middleware.ts` + tabla de rutas en `adminAccess.ts`): una llamada
     a la API de un módulo apagado responde 403 aunque se haga a mano. Se cierran todas
     las escrituras; de las lecturas, solo las propias de un módulo (actividad, usuarios,
     empresas, cupones, por aprobar). Las reservas las leen Inicio, Calendario y Reservas,
     así que su lectura queda abierta a cualquier usuario del panel.
   - **Acciones delicadas:** cada ruta las comprueba contra la base
     (`hasAdminAction`); si no se puede leer el perfil, se niega.
   - **Si el middleware no puede leer el perfil** (red, migración sin correr) deja pasar:
     el panel sigue funcionando como hoy. Un cambio de perfil tarda hasta 20 segundos en
     llegarle a un usuario con el panel abierto.
   - **Pantallas:** Configuración → Perfiles (crear y editar) y el selector de perfil en
     Configuración → Usuarios. Nadie puede quitarse a sí mismo el permiso de usuarios.
   - **No incluido:** borrar perfiles; permisos más finos dentro de un módulo (por
     ejemplo ver reservas sin poder editarlas, o reajustar montos).
   - **Probado:** 30 casos de la lógica de permisos y del candado por ruta, sin base.
     **Sin probar:** el candado con una sesión real (necesita la migración y login).
3. **Ficha del cliente y cuentas — HECHO** (`006f7c6`). **Requiere correr
   `database/migrations/add_customer_accounts.sql`** (aditiva: cuatro columnas en
   `customers`). Sin ella la ficha se abre igual y el cliente sigue entrando con el link.
   - **Ficha del cliente** (`CustomerFicha.tsx`, `GET /api/admin/customers/ficha?email=`):
     clic en el nombre en Clientes. Muestra acceso, empresa y rol, reservas (con «Abrir»),
     cotizaciones sin reserva, solicitudes, documentos (también los del equipo) y
     beneficios, más «Ver su panel». No guarda nada nuevo: junta lo que ya existe.
   - **Tres formas de entrar** (`/mi-cuenta/ingresar`, `src/lib/customerPassword.ts`):
     con mi clave; primera vez (correo + RUT + la clave que quiere usar, en un paso);
     link al correo (respaldo y recuperación). Crear o cambiar la clave: «Mis datos».
   - **El RUT del cotizador NO abre la cuenta.** Si bastara, cualquiera podría cotizar con
     el correo de otra persona, escribir un RUT que conoce y después entrar a esa cuenta.
     Por eso hay dos columnas: `rut_declared` (lo que escribió en el cotizador) y `rut`
     (confirmado por el equipo, el único que sirve para «Primera vez»). En la ficha, el
     declarado aparece con un botón «Confirmar este RUT»; también se puede escribir a mano.
   - **Cotizador:** campo «RUT (opcional)» en los datos personales; se valida solo si se
     escribe y nunca frena la cotización.
   - **Desde la ficha, el equipo puede:** cargar o corregir el RUT, confirmar el
     declarado, enviarle el link de acceso al correo y borrar su clave (vuelve a «Primera
     vez»). Todo queda en Actividad; la clave nunca se registra.
   - **Límites de intentos por IP:** primera vez 5 cada 15 min; entrar con clave 10 cada
     15 min. Los errores no dicen si el correo existe.
   - **No incluido:** editar nombre o teléfono desde la ficha; avisar por correo que se
     creó una clave; carga masiva de RUT.
   - **Sin probar con datos reales**: falta la migración y el login. Con datos inválidos
     las rutas responden 401/400 sin escribir.
4. **Mismo diseño en todo el sistema — HECHO a nivel de tema** (`8255ff0`). Sin migración.
   - **Tema «panel»** (`.theme-panel` en `src/app/globals.css`): redefine las variables
     `--primary-*` al azul del panel del cliente (#2C5282, con #1B3A5C como tono oscuro).
     Todos los botones, links, focos y selecciones del admin cambian juntos, igual que el
     tema verde del cotizador.
   - **Forma**: las primitivas compartidas (`Card`, `Button`, `Input`, `Select`) llevan una
     marca `data-ui`; dentro de `.theme-panel` las tarjetas quedan con esquinas de 16 px y
     borde suave, y botones y campos más redondeados. Fuera del tema (cotizador, landing)
     no cambia nada. Las tarjetas con borde izquierdo de color conservan su acento.
   - **`/trabajos`**: misma barra azul arriba («Yo me encargo! · MI EQUIPO · nombre»),
     botones en el azul del panel, e ingresos con la misma tarjeta que el del cliente.
   - **Ingreso del admin**: misma identidad.
   - **Globo de WhatsApp**: ya no aparece en `/admin` ni en `/trabajos` (tapaba botones);
     sigue en la web y en el panel del cliente.
   - **Verificado** en un build aparte: radios, bordes y color de acción calculados por el
     navegador, y el globo oculto solo en las rutas internas.
   - **Lo que NO es**: un rediseño pantalla por pantalla. La distribución interna de
     Reservas, Prospectos, Calendario, Flota y Configuración (tablas, modales, filtros) es
     la de siempre; cambió su color y su forma. Rehacer la distribución de cada una es un
     trabajo aparte, pantalla por pantalla, y conviene hacerlo con la secretaría mirando.

## Estado del rediseño (03-10-2026)

Las cuatro fases están en `feat/admin-rediseno`, sin push ni PR. Ninguna se probó con
sesión real (el admin necesita login). Antes de fusionar: recorrer el admin completo con
un usuario Administrador y uno de Secretaría, y confirmar que cada pantalla hace lo mismo
que antes.

## Ajustes tras ver el Preview (Francisco, 03-10-2026)

1. **Reservas, filas compactas** (`25dabb8`): a la vista quedan ver, WhatsApp, editar y
   PDF; el resto (cambiar fecha, pagos, no atendido, correo, frecuente, calendario, .ics,
   eliminar) pasa a un menú «Más» por fila (`RowMenu.tsx`, con posición fija para que el
   scroll horizontal de la tabla no lo recorte). Los montos bajan de cinco renglones a dos
   o tres. Medido en un build aparte: 57 px por fila con el menú cerrado.
2. **Prospectos**: mismo menú «Más»; a la vista quedan el siguiente paso del lead, ver,
   WhatsApp, enviar cotización y PDF.
3. **Permisos dentro de Usuarios** (`a8e7311`): la pestaña pasa a llamarse «Usuarios y
   permisos» y trae, debajo de los usuarios, el editor de perfiles (qué paneles ve cada
   uno). Ya no hay una pestaña «Perfiles» aparte.
4. **Marketing como panel propio**: módulo `marketing` en el menú (grupo Ventas), con
   «Correos» (registro de `email_log` del mes, solo lectura, con conteos por estado y por
   tipo; `GET /api/admin/emails?mes=`) y «Cupones y referidos». La acción
   `marketing.manage` se mudó a este módulo. Un perfil guardado antes de este cambio
   hereda Marketing de Configuración (`MODULE_INHERITS` en `adminAccess.ts`) hasta que se
   vuelva a guardar: nadie pierde lo que veía.
5. **Filtro de período en Inicio** (`0c082e3`): Hoy / Semana / Mes / Rango. Ingresos y
   ocupación se calculan para ese período, por fecha del servicio
   (`/api/admin/stats?desde=&hasta=`). «Reservas hoy», «Pendientes» y las cotizaciones
   vigentes no dependen del período.
6. **Crédito a IAenBlanco** (`00a53fd`): quitado del pie de la landing, de `/domicilio`,
   del ingreso del admin, del panel y de `RESUMEN_CAMBIOS_SEO.md`. Queda solo Vanlook
   Studio. **Los accesos NO se revocaron desde acá** (ver más abajo).
7. **Logo** (`09437f4`): `PanelLogo.tsx`, el logo sobre una placa blanca, en las barras del
   admin, del cliente y del equipo, y en sus tres ingresos.

8. **Panel de Finanzas** (`5a0af55`, pedido del 04-10-2026): módulo `finance` en el menú.
   - Arriba: reservado, cobrado (por canal), por cobrar y facturado con Emisso del mes.
   - «Facturar a empresas»: cada empresa con servicios del mes, cuánto tiene sin facturar
     y un botón que abre la misma revisión → vista previa del SII → emisión de su ficha
     (`CompanyBilling`). Debajo, las facturas del mes con su XML.
   - «Servicios del mes»: código, cliente y empresa, cotizado, ajustes, total, pagado,
     saldo y documento; filtros (todos, con saldo, de empresas, sin facturar) y CSV.
   - Mes por FECHA DEL SERVICIO. No calcula por su cuenta: usa `summarizeBookings`,
     `servicePrice` y `pendingAmount`. Comprobado contra la base (solo lectura): reservado,
     cobrado y por cobrar de Finanzas son iguales a los de Inicio en 2026-09 (90 servicios)
     y 2026-10 (25), y la suma de saldos de las filas es igual al «por cobrar».
   - La acción «emitir facturas» pasó de Empresas a Finanzas. Previsualizar y emitir
     exigen el módulo Finanzas; quien solo tiene Empresas ve el mes de la empresa pero no
     factura. Un perfil guardado antes hereda Finanzas de Empresas.
   - Solo facturas 33 a empresas (lo que ya existía). Boletas, facturar a una persona sin
     ficha de empresa, PDF y anulación siguen fuera.
   - Emisso sigue sin credenciales cargadas: nunca se previsualizó ni emitió de verdad.

9. **Ajustes del 04-10-2026**:
   - Una sola etiqueta «Cliente antiguo» por reserva (`d2680b0`); el nombre del prospecto
     y el del cliente en Reservas abren su detalle (`e246c76`, `52a55c9`).
   - **Panel del trabajador** (`52a55c9`): `/trabajos` tiene tres vistas — Por hacer,
     Historial (últimos 90 días: `getWorkerHistory`, mismo criterio de «le tocó» que la
     agenda) y Mis documentos (todo lo subido + documentos personales sin trabajo). Notas,
     diferencias y archivos se pueden agregar a un trabajo de la agenda o de los últimos
     30 días (`workerCanActOn`): la rendición de gastos se hace después del servicio.
   - **Kilometraje, patente y marca** (`fade559`): tarjeta en Flota
     (`FleetOdometerCard.tsx`, `src/lib/fleetKm.ts`). **Requiere correr
     `database/migrations/add_vehicle_details.sql`**; sin ella se ve la suma de trabajos
     pero no se puede guardar. Van en una tabla aparte y no en `fleet_config.vehicles`
     porque el panel de producción reescribe ese JSON y borraría los campos nuevos.
     El estimado = última lectura del tablero + km de los trabajos posteriores. Queda
     corto: la distancia es la del cotizador (origen → destino) y solo la tienen las
     reservas nacidas de una cotización. Medido el 04-10-2026 (solo lectura): de 139
     trabajos con camión, 44 tienen distancia (Camión 1: 22 de 77, 849 km; Camión 2: 19 de
     55, 156 km; Camión 3: 3 de 7, 170 km).

### Accesos de IAenBlanco: lo que se vio y lo que falta (03-10-2026)

- En GitHub, `iaenblanco` es colaborador del repo con permiso de **escritura**
  (`gh api repos/yomeencargo/cotizador-mudanzas/collaborators`). Quitarlo requiere permiso
  de administrador del repo, que tiene la cuenta `yomeencargo`; `fvanlookeren-bit` tiene
  solo escritura.
- El repo es **público**.
- Hay 7 commits de `IA en Blanco` en el historial.
- No se pudo revisar desde acá: miembros del equipo de Vercel, de Supabase, de n8n, de
  Flow, de Resend, ni variables de entorno.

## Reglas de la rama

- Las mismas de `docs/PANEL_PERFILES.md`: migraciones solo aditivas; la base es compartida
  con producción y las corre Francisco.
- El admin es lo que usa la secretaría todos los días: cada fase tiene que dejar todo
  funcionando igual que antes. Nada se saca; se reordena.

## Inicio sin montos (04-10-2026)

Pedido de Francisco: «que no hayan números en Inicio». Las tarjetas de ingresos (pagado, por
cobrar, cotizado vigente), la línea «Reservado», la tabla por origen y el gráfico «Reservas e
ingresos por mes» salieron de Inicio y viven en **Finanzas** (`FinancePanel`), para el mes
elegido ahí. Inicio queda con Reservas hoy, Pendientes, Ocupación y las listas de
hoy/mañana/semana; su filtro de período ahora solo mueve la Ocupación.

No cambió ningún cálculo ni ruta: Finanzas pide `/api/admin/stats?desde=&hasta=` (origen y
cotizado vigente) y `DashboardCharts` sigue leyendo `/api/admin/analytics`. Esas dos rutas no
tienen regla de módulo: quien no ve Finanzas ya no ve los montos en pantalla, pero la API se
los sigue respondiendo si la llama a mano.

## Emisión de facturas como panel propio (04-10-2026)

Pedido de Francisco: la sección de hacer facturas sale de Finanzas y es un panel aparte.
Módulo nuevo `invoicing` («Emisión de facturas», grupo Finanzas del menú) con
`InvoicingPanel`: empresas con servicios del mes → revisar → vista previa del SII → emitir
(el mismo `CompanyBilling`), y las facturas del mes con su XML. Finanzas queda de solo
lectura.

- La acción delicada `invoices.emit` ahora cuelga de `invoicing`, no de `finance`.
- Un perfil guardado antes hereda en cadena: Emisión de facturas ← Finanzas ← Empresas
  (`MODULE_INHERITS`), así nadie pierde acceso hasta que se edite el perfil.
- Rutas: escribir en `/api/admin/invoices` y en `/api/admin/companies/<id>/billing` exige
  `invoicing`. `/api/admin/finance` lo pueden leer `finance` e `invoicing`: el panel nuevo
  usa esa misma respuesta, que incluye el resumen del mes.

## Montos solo para Finanzas (04-10-2026)

- `/api/admin/analytics` (gráfico mensual) exige el módulo Finanzas (regla de ruta).
- `/api/admin/stats` responde a todos los conteos y la ocupación que usa Inicio; los montos
  (`revenue`, `monthlyRevenue`, `averageTicket`, `outstandingQuotes`) solo van si el usuario
  tiene Finanzas. El filtro está dentro de la ruta, no en el middleware.

## Panel «Trabajos» y avisos a trabajadores (04-10-2026)

Pedido de Francisco: un panel en Operación para apretar la reserva y asignarle camión y
trabajadores, que eso aparezca en el perfil del trabajador, con notificaciones.

- **Default por camión, sin tocar nada:** cada reserva recibe camión del reparto automático
  y los trabajadores con ese camión habitual ya la ven en `/trabajos`.
- **Módulo `jobs`** («Trabajos», `JobsPanel`): trabajos de hoy + 13 días (rango editable,
  tope 62 días), agrupados por día. Al abrir uno: cambiar camión, sumar o sacar gente de la
  cuadrilla, link de WhatsApp con el mensaje escrito para cada uno, y «Ver la reserva».
  Filtro «Sin nadie asignado».
- **API:** `GET /api/admin/jobs`, `PUT /api/admin/jobs/<id>` (`{ vehicleId?, workerIds? }`),
  ambas con el módulo `jobs`. La lógica está en `src/lib/adminJobs.ts` y la usa también la
  cuadrilla del detalle de la reserva. Un perfil guardado antes hereda Trabajos de Reservas.
- **Avisos** (`worker_notifications`, migración `add_worker_notifications.sql`): se escribe
  uno cuando a alguien le toca un trabajo (cuadrilla, cambio de camión o reparto automático
  hacia su camión habitual), cuando se lo quitan, cuando se reprograma y cuando se cancela.
  Solo trabajos de hoy en adelante; sin precios. El trabajador los ve en `/trabajos` →
  «Avisos», con el número de no leídos en la pestaña; abrirla los marca leídos.
- Sin la migración todo funciona igual: asignar no falla, solo no quedan avisos.
- El aviso es dentro del panel. Nada se envía solo al teléfono: el WhatsApp lo manda quien
  aprieta el botón. Borrar una reserva (no cancelarla) no avisa.

## Avisos por correo con Resend, sin n8n (04-10-2026)

Pedido de Francisco: que las notificaciones también salgan por correo con Resend, desde el
código, sin n8n de intermediario.

- `src/lib/resendClient.ts`: `POST https://api.resend.com/emails` con `RESEND_API_KEY` y
  `RESEND_FROM` (opcional). Sin la API key no se envía nada por acá. Respeta
  `EMAIL_PAUSED`, `EMAIL_DRY_RUN` y `EMAIL_ALLOWLIST`. Cada aviso lleva `Idempotency-Key`
  con el id de su fila, así un reintento no duplica.
- Cada aviso de `worker_notifications` se manda además por correo al trabajador que tenga
  correo en su ficha (campo nuevo en Flota y equipo). El resultado queda en la fila:
  `email_status` = `sent` / `failed` / `skipped:<motivo>`.
- Migración `add_worker_email.sql` (aditiva): `workers.email` y las tres columnas de estado.
  Sin ella no sale correo y el resto sigue igual; el correo se lee aparte de
  `WORKER_FIELDS` para no botar el ingreso de trabajadores si la columna no existe.
- Los correos a clientes se migraron después: ver la sección siguiente.

## Correos a clientes: de n8n a Resend directo (04-10-2026)

Pedido de Francisco: migrar también los correos a clientes, sin n8n de intermediario.

- `src/lib/emailTemplates.ts`: las plantillas del workflow de n8n «mail web»
  (`psmygb0sPt0OQddx`) traídas tal cual — las tres ramas: cotización (nueva y ajustada),
  aviso de pago aprobado al dueño, y los 14 eventos del sistema de correos. Comparado contra
  el código original de n8n en 45 payloads de prueba: destinatario, asunto y HTML idénticos.
- `src/lib/emailTransport.ts` (`sendSystemEmail`): el único camino de salida. **Con
  `RESEND_API_KEY` sale directo por Resend; sin ella sigue por el webhook de n8n.** Así,
  desplegar antes de cargar la key no corta ningún correo.
- Lo usan `emailLog.ts` (cron y transaccionales), las dos rutas de cotización y el aviso de
  pago de `paymentSync.ts`. La idempotencia, el tope de frecuencia, la ventana horaria y
  `EMAIL_PAUSED` / `EMAIL_DRY_RUN` / `EMAIL_ALLOWLIST` de `emailLog.ts` no cambiaron.
- Misma lectura del resultado que antes: Resend OK = enviado; Resend responde error =
  fallo reintentable; timeout o red = ambiguo, queda `pending`. Cada envío de `email_log`
  lleva `Idempotency-Key` `email-log/<id>/<intento>`.
- Remitente: `Yo me Encargo <contacto@yomeencargo.cl>` (el que usaba n8n), cambiable con
  `RESEND_FROM`.
- **Cambia una cosa para el cliente:** la cotización y el aviso de pago al dueño salían por
  la cuenta de Gmail conectada en n8n; ahora salen por Resend desde `contacto@`. Las
  respuestas del cliente a la cotización llegan a esa casilla.
- No se tocó n8n: el workflow sigue activo como respaldo. El calendario de Google
  (`N8N_CALENDAR_WEBHOOK_URL`) sigue usando n8n; no es correo.

## Un solo filtro de fecha en todo el panel (07-10-2026)

Pedido de Francisco: Inicio, Reservas y Trabajos tenían filtros de fecha distintos y en
lugares distintos. Ahora hay uno solo, arriba a la derecha de cada pantalla con registros.

- `src/components/admin/PeriodFilter.tsx` (el control) y `src/lib/period.ts` (las reglas).
- Opciones: Todo · Hoy · Mañana · Semana · Mes · Rango. Cada pantalla muestra las que le sirven
  («Mañana» no aparece en Actividad ni en Finanzas; «Todo» no aparece donde hace falta un rango).
- Reglas iguales en todas partes, con «hoy» en hora de Chile:
  - Semana = de lunes a domingo de la semana en curso.
  - Mes = el mes calendario en curso.
  - Rango = entre dos fechas; con una sola punta filtra desde o hasta ella.
- Pantallas: Inicio, Reservas, Trabajos, Prospectos, Actividad, Finanzas y Marketing → Correos.
- Finanzas y Correos filtraban solo por mes: sus rutas ahora aceptan `?desde=&hasta=`
  (siguen aceptando `?mes=`). Un rango igual a un mes da las mismas cifras que el mes.
- Prospectos conserva el selector «la fecha es la de cotización / la de la mudanza».

Cambios de significado respecto de antes:
- Reservas: «Esta semana» era de hoy a 7 días; ahora es lunes a domingo.
- Prospectos: desaparecen «Última semana» y «Próximos 7 días»; queda «Semana» (lunes a
  domingo) y «Rango» para lo demás.

Sin cambiar: Emisión de facturas sigue por mes (la factura es mensual), el Calendario tiene su
propia navegación, y Por aprobar, Clientes y Empresas no tenían filtro de fecha.

## Links de archivos sin la dirección de la base (08-10-2026)

Pedido de Francisco: los links de las fotos mostraban la dirección del proyecto de Supabase.

- **Fotos del cliente y PDF** (bucket `bookings`, público): ahora se piden por
  `/archivos/bookings/<carpeta>/<archivo>` en el dominio del sitio, y el servidor los entrega
  (`src/app/archivos/[...path]/route.ts`). Solo sirve las carpetas `photos`, `booking-pdfs` y
  `prospect-pdfs`.
  - Subidas nuevas: se guarda directamente el link del sitio.
  - Lo ya guardado: `toHiddenFileUrl` (`src/lib/fileLinks.ts`) lo convierte al mostrarlo, en
    el panel, en el cotizador, en el panel del cliente y en los correos.
- **Documentos privados** (bucket `documentos`): las tres rutas que los abren (admin, cliente,
  trabajador) ya no redirigen a un link firmado; el archivo sale desde el servidor, con la
  misma validación de sesión de antes.

Esto oculta la dirección; no cambia quién puede ver qué. El bucket `bookings` sigue siendo
público: quien conozca el link viejo de un archivo todavía lo abre. Para cerrarlo hay que
pasar ese bucket a privado en Supabase (la ruta `/archivos` sigue funcionando igual, porque
lee con la credencial del servidor).


## Permisos por subpanel (13-10-2026, rama `feat/permisos-subpaneles`)

Sin migraciones: se guarda en el mismo `permissions` del perfil, en `sections`.

- **Registro** (`adminModules.ts`): cada módulo declara sus `sections` (las pestañas que tiene
  adentro). Hoy: Trabajos (Por asignar, Historial), Por aprobar (Solicitudes, Diferencias en
  terreno, Gastos de trabajadores), Marketing (Correos, Cupones y referidos), Finanzas
  (Resumen, EERR, Gastos, IVA y banco, Pago a trabajadores, Cierre de pagos) y Configuración
  (Precios, Horarios, Inventario, Pago a trabajadores, Políticas y términos).
- **Regla**: un subpanel vale si su módulo está encendido y el perfil no lo tiene apagado a
  propósito. Lo que un perfil no menciona está encendido, así que los perfiles existentes no
  pierden nada y un subpanel nuevo aparece encendido.
- **Candado en la API** (`adminAccess.ts`, `sections` en `ROUTE_RULES`): la ruta de un
  subpanel apagado responde 403 aunque se llame a mano. No es solo ocultar la pestaña.
- **Editor**: Configuración → Usuarios y permisos → Perfiles, casillas «Subpaneles que ve»
  bajo cada módulo.
- Para sumar un subpanel: agregarlo al registro, filtrarlo en su panel con `allowed` y, si
  tiene rutas propias, ponerles `sections`.
