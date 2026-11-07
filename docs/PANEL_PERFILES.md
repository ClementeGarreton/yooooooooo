# Panel de perfiles — rama `feat/perfil-del-cliente`

Construcción de la propuesta «Panel de perfiles y trazabilidad» (vault:
`01-Projects/Clientes/YoMeEncargo/Propuesta_Panel_Perfiles_2026-09.md`). Empezó el
2026-10-01 por pedido de Francisco, antes de la aprobación formal de Tomás.

## Cómo se trabaja la rama

- **Producción sale solo de `main`.** Verificado el 2026-10-01 en los deployments de
  GitHub: los 40 últimos de `Production` son commits de `main`; las ramas `feat/*` solo
  generan deploys de `Preview`. Mientras esta rama no se fusione, nada de `/mi-cuenta`
  llega a yomeencargo.cl y `main` se sigue desplegando como siempre.
- **Traer `main` a la rama seguido** (`git merge main`), para que la fusión final no sea
  un choque de semanas.
- **La base NO está aislada.** Producción y los Preview usan la misma Supabase. Por eso:
  - toda migración de esta rama es **solo aditiva** (tablas o columnas nuevas, nullable o
    con default; nunca renombrar, borrar ni cambiar el tipo de algo que `main` usa);
  - las migraciones las corre Francisco a mano en el SQL editor (la base es de solo
    lectura para agentes) y se pueden correr antes de fusionar sin que `main` note nada;
  - probar en un Preview escribe en la base real: usar cuentas de prueba propias.

## Migraciones de la rama

| Archivo | Qué agrega | Estado |
|---|---|---|
| `database/migrations/add_customer_login_tokens.sql` | Tabla `customer_login_tokens` (links de acceso de un solo uso) | Corrida (01-10-2026) |
| `database/migrations/add_panel_perfiles_fase2.sql` | `companies`, `workers`, `booking_workers`, `documents`, bucket `documentos` | Corrida (01-10-2026) |
| `database/migrations/add_service_requests.sql` | Tabla `service_requests` (solicitudes del panel) | Corrida (03-10-2026) |
| `database/migrations/add_booking_modifications.sql` | Tabla `booking_modifications` (diferencias en terreno) | Corrida (03-10-2026) |
| `database/migrations/add_invoices.sql` | Tablas `invoices` e `invoice_bookings` (facturación con Emisso) | Corrida (03-10-2026) |
| `database/migrations/add_coupons.sql` | Tablas `coupons`, `coupon_redemptions` y `marketing_config` (cupones y referidos) | Corrida (03-10-2026) |

## Módulo 1 — Panel del Cliente

1. **Acceso por link al correo** — hecho en código (2026-10-01), sin probar contra la base:
   - `/mi-cuenta/ingresar` pide el correo → `POST /api/cuenta/acceso` → si es cliente,
     crea un link de 15 min, un solo uso, y lo manda por n8n (`event: customer_login_link`).
   - `/mi-cuenta/entrar?t=…` muestra un botón; el canje es `POST /api/cuenta/entrar`
     (abrir el link no lo gasta: los antivirus de correo lo abren solos).
   - Sesión: cookie `customer_session` firmada (`src/lib/customerSession.ts`, versión
     `c1`, 30 días), atada al `customer_id`.
   - `/mi-cuenta`: datos del cliente, reservas (total, pagado, saldo) y cotizaciones
     (vigente/vencida con la misma regla del dashboard). Todo filtrado por el
     `customer_id` de la sesión, en el servidor.
   - **Bloqueos para probarlo de punta a punta:**
     - correr la migración;
     - agregar en el workflow de n8n «mail web» (`psmygb0sPt0OQddx`) la rama del Switch
       para `event = customer_login_link` con su plantilla. Sin eso n8n no confirma el
       envío y el correo queda `failed` en `email_log`.
2. **Retomar cotización y PDF** — hecho en código (2026-10-01):
   - «Retomar» = **reservar y pagar una cotización vigente al precio cotizado** (o al
     ajustado por el panel). `POST /api/cuenta/cotizaciones/[id]/reservar` arma la
     pre-reserva y la orden de Flow con lo guardado en la base, leído en el servidor; el
     navegador solo elige abono 50% o pago completo −5% y acepta las Políticas de Garantía
     (mismas opciones que el resumen del cotizador). Reutiliza `ensureProvisionalBooking`
     y `createQuoteFlowOrder` por `quote_id`, así el webhook de Flow y el admin no cambian.
   - Se puede reservar si está vigente (misma regla del dashboard, `isOutstandingQuote`),
     tiene `quote_id` y no es visita a domicilio. Medido el 01-10-2026: 253 de 1.243
     cotizaciones no tienen `quote_id`; de esas no se ofrece reservar.
   - PDF: `GET /api/cuenta/cotizaciones/[id]/pdf` redirige al PDF ya generado (las 87
     vigentes del 01-10-2026 lo tienen). Una cotización ajena responde 404, igual que una
     inexistente.
   - El panel agrupa las filas repetidas de una misma cotización (22 `quote_id` repetidos)
     y oculta las pre-reservas sin pagar: se siguen viendo como cotización vigente.
   - Vencidas: PDF y «Cotizar de nuevo» (va al cotizador vacío).
   - **No hecho — «Usar como base»** (abrir una cotización vieja en el cotizador para
     editarla): lo guardado no alcanza para reconstruir el cotizador. Las direcciones se
     guardan como una sola línea de texto, los ítems sin peso ni categoría y no se guarda
     el tipo de propiedad. Para que sea posible hay que empezar a guardar el estado
     completo del cotizador (columna JSONB nueva, aditiva) — y conviene que eso llegue a
     `main` antes que el resto del panel, para que las cotizaciones nuevas ya lo traigan.
3. **Reservas con paradas y volumen** — hecho en código (2026-10-01):
   - `/mi-cuenta/reservas/[id]`: fecha larga, hora y horas estimadas (`duration_hours`),
     origen, paradas en orden con la nota del cliente, destino, volumen (m³ y cantidad
     de artículos) y el estado de pago (total, pagado, saldo). Cada reserva de la lista
     tiene «Ver detalle».
   - El volumen y los artículos no viven en la reserva sino en su cotización: se
     emparejan con `mergeBookingQuoteDetails`, la misma función del admin, pasándole solo
     las cotizaciones de ese cliente. Medido el 01-10-2026 sobre las 230 reservas
     visibles: el panel da el mismo volumen que el admin en las 230; 131 tienen volumen
     y 99 no (sin cotización enlazada), y a esas no se les muestra la fila.
   - Paradas: la columna `bookings.stops` existe; hoy 1 de 230 reservas tiene paradas.
   - Una reserva ajena, un bloqueo o una pre-reserva sin pagar responden 404.
   - **No incluido:** descargar la orden en PDF (aparece en el mockup de la propuesta
     pero no en el alcance del punto 6), pisos y ascensor, la lista de artículos y las
     notas internas del admin (`notes`), que no se muestran al cliente.
4. **Reprogramar con cupo validado** — hecho en código (2026-10-01):
   - Reglas que decidió Francisco el 01-10-2026: (1) solo con **más de 48 h** de aviso,
     igual que la cancelación sin cargo de las Políticas de Garantía; con menos, el panel
     deriva a WhatsApp. Las 48 h valen también para el horario nuevo. (2) Solo a días con
     **recargo igual o menor** (sábado, domingo, feriado; `dateSurcharge`); el precio no
     cambia. Recargos reales al 01-10-2026: sábado 0%, domingo 15%, feriado 15%.
   - `GET/POST /api/cuenta/reservas/[id]/reprogramar`: días ofrecidos (pasado mañana a
     180 días, con los de más recargo deshabilitados), horarios del día y el cambio. Todo
     se valida en el servidor (`src/lib/customerReschedule.ts`).
   - El cupo usa `getSlotAvailability` (`src/lib/slotAvailability.ts`), extraído de
     `/api/bookings/available` sin cambiar su respuesta (verificado byte a byte en 8
     fechas), sin contar a la propia reserva. El cliente nunca agenda con sobrecupo.
   - Al mover: `vehicle_id = null` (el reparto automático asigna un camión libre), UPDATE
     condicionado a la fecha de antes (un doble clic responde 409) y registro en
     Actividad (`booking.rescheduled`, a nombre de «cliente CL-…»).
   - Solo reservas confirmadas o pendientes, que no sean visitas a domicilio.
   - **Efectos que no se tocaron:** los recordatorios #08 (D-3) y #09 (D-1) son uno por
     reserva; si el cliente reprograma después de recibir el D-3, no le llega otro para la
     fecha nueva (el D-1 sí). El calendario personal de Tomás, donde duplica reservas a
     mano, no se actualiza solo. No se avisa al admin aparte de Actividad.
   - Dato de configuración visto al probar: en `schedule_config` el horario 12:00 tiene
     la etiqueta «13:00» y el 16:00 la etiqueta «17:00». El cotizador y el panel muestran
     la hora, no la etiqueta, así que el cliente no lo ve.
5. **Saldo y pago por Flow** — hecho en código (2026-10-01):
   - «Pagar saldo con Flow» en el detalle de la reserva. `POST
     /api/cuenta/reservas/[id]/pagar-saldo` cobra el SALDO COMPLETO de `pendingAmount()`
     (el navegador no manda monto) con la misma orden que el link de saldo del admin:
     `createBalanceFlowOrder` (`src/lib/balancePayment.ts`), extraída de la ruta del
     admin con salida idéntica (verificado con Flow simulado). Queda en Actividad.
   - Se ofrece solo si hay saldo, `quote_id`, correo y la mudanza es **hoy o después**.
     Medido el 01-10-2026: de 30 reservas con saldo, 26 eran mudanzas pasadas, donde el
     saldo suele estar cobrado en efectivo o transferencia sin registrar.
   - Exige el libro de pagos (`add_booking_payments.sql`), igual que el admin: sin él, el
     saldo cobrado no se sumaría a `amount_paid`.
   - **Arreglo en `paymentSync` (commit aparte `464b5a5`, sirve solo para `main`):** un
     cobro de saldo rechazado o anulado cancelaba la reserva si esta no tenía un pago
     aprobado antes (3 de 6 reservas futuras con precio estaban así). Ahora una orden de
     saldo no aprobada no toca la reserva. El riesgo existe hoy en producción con los
     links de saldo del admin.
   - Después de pagar, Flow devuelve a `/pago/exito`, igual que el link del admin (no se
     cambió). Ojo: esa página registra la conversión con el monto pagado, también para un
     saldo.
   - No incluido: abono parcial del saldo (sigue siendo solo del admin).
6. WhatsApp con contexto.
7. Cuenta empresa (razón social, RUT, datos de facturación).

## Etapa 2 — propuesta aprobada por Tomás (01-10-2026)

Paquete módulos 1–5 por $1.600.000 + facturación $20.000/mes. Pedidos de Francisco tras
la reunión: cliente, empresa y trabajador suben fotos de documentos; la empresa es una
entidad propia a la que se asocian clientes, con un ID para facturar mensual; facturas
por Emisso; el panel del cliente tiene que verse bien en monitor y todo tiene que ser
clickeable; el admin ve cada perfil.

### Decisiones (Francisco, 01-10-2026)

- **Trabajador:** entra con **RUT + PIN personal** que crea el admin. Reemplaza al PIN
  compartido del link de choferes.
- **Empresa:** el admin asocia clientes a una empresa como **encargado** (ve todas las
  reservas, documentos y facturas de la empresa) o **miembro** (ve solo lo suyo).
- **Factura mensual:** la **emite el admin con un clic** desde el panel, revisando lo
  del mes. Nunca automática.

### Base de datos: `database/migrations/add_panel_perfiles_fase2.sql` (corrida por Francisco el 01-10-2026)

`companies` (EMP-00001), `customers.company_id/company_role`, `bookings.company_id`,
`workers` (TRB-0001, RUT + hash del PIN), `booking_workers`, `documents` y el bucket
privado `documentos` (URLs firmadas, nunca públicas). Solo aditiva.

### Regla: una sola plataforma (Francisco, 01-10-2026)

Todo lo nuevo se conecta al **admin que ya existe** (`/admin`, `src/app/admin/page.tsx` y
`src/components/admin/*`) y al **link de choferes que ya existe** (`/trabajos/[token]`). No
se arma un segundo admin ni un segundo panel de trabajadores. El Panel del Cliente
(`/mi-cuenta`) es la única cara nueva, porque es para otro público, y comparte la misma
app, base, `src/lib` y deploy.

- Documentos → sección dentro del detalle de reserva de **Reservas** (hecho).
- Empresas → pestaña nueva **Empresas** en la barra del admin, junto a **Clientes**;
  asociar clientes desde la ficha que ya está en **Clientes**.
- Trabajadores → alta y PIN en **Flota** (donde hoy está el acceso de choferes); el panel
  del trabajador es el mismo `/trabajos`, cambiando el PIN compartido por RUT + PIN
  personal y agregando la subida de fotos/gastos.
- Factura mensual → botón en la ficha de la empresa, dentro del admin.
- «Ver como lo ve» un cliente, empresa o trabajador → botón en sus fichas del admin.

### Orden de construcción

1. **Panel del cliente rediseñado** — barra lateral (Resumen, Reservas, Cotizaciones,
   Documentos, Empresa), pensado para monitor y celular, tarjetas enteras clickeables,
   detalle de reserva con todas sus acciones.
2. **Documentos** — subir fotos/PDF desde el panel del cliente (por reserva o de la
   empresa), ver y descargar con URL firmada; el admin los ve en la ficha de la reserva.
3. **Empresas en el admin** — crear empresa, asociar clientes (encargado/miembro),
   ficha de empresa con sus reservas, documentos y facturas; vista del panel empresa
   para el encargado.
4. **Trabajadores** — alta en el admin (RUT + PIN), asignación a reservas, panel del
   trabajador (servicios del día, subir fotos/gastos/documentos). Módulo 2.
5. **Solicitudes, aprobación y asignación** — Módulo 3.
6. **Modificaciones en terreno con aprobación** — historial auditable, Módulo 4.
7. **Facturación con Emisso** — factura 33 por empresa al mes (previsualizar + emitir),
   con clic del admin. Requiere: empresa de Tomás conectada en Emisso «como
   representante» con «Emitir documentos en el SII», y una API key propia en el `.env`
   del servidor. Referencia: `~/AI/Finanzas/prompt-ordenox-facturacion-emisso.md`.
8. **Integración marketing** — cupones y referidos, Módulo 5.
9. **Admin: vista de cada perfil** — entrar a ver cómo ve su panel un cliente, una
   empresa o un trabajador (solo lectura), además de sus fichas.

### Paso 2 — Documentos (hecho, commit 933590c)

- **Subida en tres pasos**, porque Vercel corta el cuerpo de una petición a 4,5 MB y dos
  fotos de celular ya lo pasan: `POST /api/cuenta/documentos/subir` devuelve un permiso
  firmado por archivo (ruta `clientes/<customerId>/<año>/<mes>/<uuid>`, la decide el
  servidor) → el navegador sube directo al bucket → `POST /api/cuenta/documentos/confirmar`
  revisa cada archivo (carpeta propia, ≤ 15 MB, primeros bytes de JPG/PNG/WEBP/HEIC/PDF
  y del mismo tipo declarado) y recién ahí inserta en `documents`. O todos o ninguno: si
  uno falla se borra la tanda. Todas las rutas se validan ANTES de borrar nada, y una ruta
  ya registrada no se puede re-confirmar (si no, se podía borrar un archivo ajeno o uno
  ya guardado).
- **Ver/descargar:** `GET /api/cuenta/documentos/<id>` (`?descargar=1`) redirige a una URL
  firmada de 5 minutos; un documento ajeno responde 404. Reglas de quién ve qué en
  `src/lib/customerDocuments.ts` (encargado ve lo de la empresa; miembro, lo suyo).
- **Pantallas:** página «Documentos» en el panel (todo lo visible + subida suelta) y
  sección «Fotos y documentos» en el detalle de cada reserva (subida asociada a ella).
  Componentes comunes en `src/components/documents/` para reutilizarlos en el panel del
  trabajador.
- **Admin:** lista de solo consulta en el detalle de la reserva
  (`GET /api/admin/bookings/<id>/documents`, `GET /api/admin/documents/<id>`).
- **Falta probar con un archivo real**: la subida directa al bucket (PUT al permiso
  firmado) no la probé porque escribe en el storage de producción.

### Paso 3 — Empresas (hecho, commit 6abe265)

- **Admin, pestaña Empresas** (`src/components/admin/CompaniesManagement.tsx`, dentro del
  admin existente): lista con buscador, «Nueva empresa» y ficha con cuatro bloques —
  datos de facturación (RUT validado con módulo 11 y guardado normalizado,
  `src/lib/rut.ts`), personas, reservas y documentos. Rutas en `/api/admin/companies/*`
  y buscador de personas en `/api/admin/customers/search`. Cada cambio queda en Actividad
  (`company.*`).
- **Dos vínculos separados** (`src/lib/companies.ts`): `customers.company_id` dice quién
  pertenece a la empresa y con qué rol; `bookings.company_id` dice qué se le factura.
  Asociar a una persona NO mueve sus reservas (puede tener mudanzas personales): la ficha
  muestra las reservas de sus personas sin asignar, marca las que se reservaron con el
  mismo RUT y se asignan con un clic (una o todas las del RUT). Solo se pueden asignar
  reservas de personas de la empresa. Una persona pertenece a una sola empresa.
- **Panel del cliente, página Empresa** (`/mi-cuenta/empresa`, el link aparece solo si la
  persona tiene empresa): datos de facturación y, para el encargado, las reservas de la
  empresa. Abrir una reserva de otra persona muestra el detalle en solo lectura (sin
  pagar ni cambiar fecha) y permite ver y subir documentos.
- **Sin probar con datos reales**: no hay empresas creadas y el admin necesita login. La
  primera prueba (crear empresa, asociar, asignar) la hace Francisco.
- **No incluido**: borrar empresas; asignar la empresa al crear la reserva (hoy se asigna
  después, desde la ficha).

### Paso 4 — Trabajadores (hecho, commit 9c54727)

- **Admin, pestaña Flota** (`WorkersCard.tsx`, entre el acceso de choferes y la flota):
  alta con nombre, RUT (es el usuario), teléfono, camión habitual y PIN; editar, cambiar
  PIN, desactivar. El PIN se guarda solo como hash PBKDF2 y no se puede volver a ver.
  **PIN de 6 a 8 dígitos** (no 4): acá no hay un link secreto delante, el PIN es la única
  barrera. Rutas `/api/admin/workers/*`.
- **Admin, detalle de la reserva** (`BookingWorkers.tsx`): la cuadrilla, marcando
  trabajadores (`booking_workers`). Queda en Actividad.
- **Panel del trabajador = `/trabajos`** (sin token): entra con RUT + PIN
  (`/api/trabajos/entrar`, 10 intentos cada 15 min por IP, mismo mensaje de error para
  RUT inexistente y PIN malo). Ve la MISMA agenda del link por camión —el código se movió
  a `src/components/trabajos/DriverAgendaView.tsx` y lo usan las dos entradas—, filtrada
  a lo que le toca: los trabajos de su camión habitual más los que tenga asignados
  (`src/lib/workerJobs.ts`). Sin precios, misma ventana de 4 días.
- **Sesión** (`src/lib/workerSession.ts`): cookie `worker_session`, 30 días. La firma
  incluye el hash del PIN: cambiarle el PIN o desactivarlo lo saca al tiro.
- **Desde cada trabajo** puede dejar notas (quedan firmadas con su nombre y código) y
  subir fotos del servicio, gastos (con monto) y documentos; ve solo lo que subió él.
  Solo puede subir a trabajos de su agenda. El admin lo ve en el detalle de la reserva.
- **El cliente NO ve lo que sube el equipo** (`canSeeDocument` y `listCustomerDocuments`
  excluyen `uploaded_by_type = 'trabajador'`): son fotos internas y respaldos de gastos.
  Qué se le muestra al cliente lo define el paso 6 (modificaciones con aprobación).
- **Los links por camión (`/trabajos/<token>`) siguen funcionando igual**; se retiran
  cuando Tomás decida, borrando sus tokens en Flota.
- **Sin probar con datos reales**: no hay trabajadores creados; el link por camión con
  un token válido tampoco se probó después de mover la agenda al componente común (no se
  leen tokens ni PIN de producción). Primera prueba: Francisco.

### Paso 5 — Solicitudes, aprobación y asignación (hecho, commit 4b154dc)

**Requiere correr `database/migrations/add_service_requests.sql`** (aditiva). Sin ella, el
panel y la bandeja muestran un aviso en vez de fallar.

- **Panel del cliente, «Solicitudes»**: formulario «Nueva solicitud» igual al mockup
  aprobado (mudanza / transporte / carga, origen, destino, fecha, hora opcional, contacto
  en origen, qué se traslada; si la persona tiene empresa, «es para la empresa»). Enviar
  no agenda ni cobra. La lista muestra el seguimiento de cada una: enviada → cotizada y
  aprobada → equipo asignado → servicio realizado (o rechazada con su motivo). El
  encargado ve también las de su empresa. Tope de 10 pendientes por persona.
- **Admin, pestaña «Por aprobar»** (con globo de pendientes): bandeja + detalle.
  - **Aprobar y agendar** abre la «Nueva reserva» de siempre con los datos de la
    solicitud; quien aprueba revisa fecha y hora y le pone el precio. Al guardar, el
    servidor deja la solicitud aprobada y enlazada a la reserva (`approveRequestWithBooking`,
    llamado desde `POST /api/admin/bookings` con `service_request_id`) y le copia la
    empresa a la reserva. No se duplicó la creación de reservas: cupos, camión, ficha del
    cliente, correo y link de pago son los mismos de una reserva manual.
  - **Rechazar** pide un motivo que el cliente lee en su panel.
- **Asignación y cierre** no se guardan dos veces: el seguimiento los lee de la reserva
  (camión, cuadrilla, estado) y de `admin_activity_log`, que ya tiene fecha y usuario. En
  el admin se ve el usuario de cada paso; en el panel del cliente, no.
- **Precio de transporte y carga**: lo pone a mano quien aprueba. Un tarifario propio
  quedó fuera de esta etapa en la propuesta.
- **Sin responder por Tomás, resuelto así por ahora** (preguntas de la propuesta):
  - Qué requiere aprobación: toda solicitud. Lo que el cliente hace solo sigue igual
    (reservar una cotización vigente, pagar, cambiar fecha con las reglas del paso 4).
  - Qué se asigna: camión y cuadrilla, en la reserva.
  - Cuándo está cerrado: reserva en estado «completada».
  - Solicitudes iniciadas por un TRABAJADOR: no construidas (falta definir si puede
    cotizar o solo solicitar).
- **Sin aviso por correo al llegar una solicitud**: hoy se ve en el globo de la pestaña.
  Un correo necesitaría un evento nuevo en el n8n «mail web».
- **Sin probar con datos reales**: falta la migración y el login del admin.

### Paso 6 — Modificaciones en terreno con aprobación (hecho, commit c40816b)

**Requiere correr `database/migrations/add_booking_modifications.sql`** (aditiva). Sin
ella, el trabajador recibe un aviso al registrar y la bandeja lo indica.

- **Trabajador (`/trabajos`, en cada trabajo): «Registrar diferencia con lo cotizado»** —
  dato (bultos, volumen, horas, paradas, otro), cotizado, en terreno y motivo. «Cotizado»
  se precarga con los bultos declarados cuando la cotización los trae. Queda pendiente y
  ve el estado de las suyas. Se agregan, no se editan. Solo en trabajos de su agenda.
- **Admin, «Por aprobar»**: las modificaciones entran a la misma bandeja que las
  solicitudes (y cuentan en el globo). El detalle muestra cotizado → encontrado, el motivo,
  quién la registró, el precio vigente y un campo de **ajuste** con el nuevo total.
  - **Aprobar**: quien aprueba fija el ajuste (vacío = sin cambio de precio; con «-»,
    rebaja). El sistema no calcula el precio. «Ajustar» del mockup es ese mismo campo.
  - **Rechazar**: pide motivo.
- **Efecto en la reserva** (`resolveModification`): con ajuste ≠ 0 se escribe
  `adjusted_price` (+ comentario, fecha y usuario), el mismo campo del reajuste manual;
  `original_price` no se toca. La modificación guarda precio antes y después. Si el ajuste
  de la reserva falla, la aprobación se revierte.
- **Historial del servicio** en el detalle de la reserva del admin (`BookingHistory.tsx`,
  `GET /api/admin/bookings/<id>/history`): solicitud de origen, cada cambio de Actividad
  con su usuario, y las modificaciones con quién registró y quién resolvió.
- **Sin responder por Tomás, resuelto así por ahora**:
  - Qué puede modificar el trabajador: bultos, volumen, horas, paradas u «otro», en texto.
  - Precio nuevo: lo fija quien aprueba.
  - Aviso de pendiente: solo el globo de «Por aprobar» (sin correo ni WhatsApp).
  - Gastos: respaldo con monto (paso 4), sin flujo de aprobación.
- **El cliente no ve las modificaciones**: ve el total y el saldo nuevos de su reserva.
- **Sin probar con datos reales**: falta la migración y un trabajador creado.

### Paso 7 — Facturación mensual con Emisso (hecho, commit 6909c2e)

**Requiere** correr `database/migrations/add_invoices.sql` (aditiva) y cargar en el entorno
del servidor `EMISSO_API_KEY` (permisos `sii:read` y `sii:write`) y `EMISSO_CONNECTION_ID`
(la conexión `conn_…` de la empresa de Tomás). Sin eso la ficha muestra el mes pero no
previsualiza ni emite. **Nunca se emitió nada durante el desarrollo**: no hay ambiente de
prueba en Emisso y todo lo emitido es un documento tributario real.

- **Dónde**: ficha de la empresa en el admin, bloque «Facturación mensual»
  (`CompanyBilling.tsx`). Se elige el mes y se ven las reservas de la empresa con fecha en
  ese mes: cotizado, ajustes aprobados (reajustes y modificaciones en terreno), total,
  pagado y si ya están facturadas. Vienen marcadas las completadas sin facturar.
- **Dos pasos, los dos a mano** (`src/lib/invoicing.ts`, `src/lib/emisso.ts`):
  1. «Previsualizar factura» → `sii.dte.previsualizar` (factura 33, a crédito). El SII
     devuelve neto, IVA y total; se guarda la fila con su clave de idempotencia. Vence en
     15 minutos.
  2. «Emitir factura ante el SII» → confirmación explícita → `sii.dte.emitir`.
- **Solo el perfil Administrador** previsualiza y emite (`isAdministrator`).
- **Montos**: los precios del panel ya incluyen IVA; a Emisso va el neto
  (`round(total / 1,19)`) y el IVA lo calcula el SII. Si el total difiere en pesos del
  panel, la vista previa lo muestra.
- **Líneas**: una por servicio («Servicio RES-000318») hasta 10; con más de 10, una sola
  línea «Servicios MM/AAAA» y el detalle queda en `invoice_bookings`.
- **Receptor**: razón social, RUT, giro (≤ 40), dirección (≤ 70), comuna (≤ 20) y ciudad
  (≤ 15) salen de la ficha. Si falta o sobra largo, no se trunca: se avisa qué corregir.
- **Seguridad de la emisión** (documentación de Emisso, «Resultados y errores», leída el
  03-10-2026):
  - La clave de idempotencia se guarda antes de llamar y no se cambia para reintentar.
  - Errores declarados como previos al envío (`EMISSO_PRE_SEND_ERRORS`) → «No se emitió»;
    se puede previsualizar de nuevo.
  - Cualquier otro error, timeout o `resultado_desconocido` → «Resultado desconocido»:
    las reservas quedan bloqueadas y solo existe «Consultar resultado», que repite la
    misma llamada con la misma clave (no reenvía nada).
  - Una reserva no entra en dos facturas (bloquean: emitiendo, emitida, desconocido).
- **Después de emitir**: se guarda folio, operación y el XML firmado (descargable desde la
  ficha). El encargado ve las facturas emitidas en `/mi-cuenta/empresa`.
- **No incluido**: PDF de la factura (Emisso entrega el XML; el PDF habría que
  generarlo), envío de la factura por correo, anulación con nota de crédito, boletas,
  marcar la factura como pagada.
- **Sin verificar**: que la empresa de Tomás emita por el Facturador Gratuito del SII
  (Emisso solo emite por ahí; si usa otro sistema, esto no sirve), y la llamada real a
  Emisso desde este código (no hay credenciales cargadas).

### Paso 8 — Cupones y referidos (hecho, commit 45f1249)

**Requiere correr `database/migrations/add_coupons.sql`** (aditiva). Sin ella, «Beneficios»
dice que el programa no está activo, reservar sin cupón funciona igual y el admin lo avisa.

**Decisiones de Francisco (03-10-2026):** los cupones se usan **solo en el panel** (el
cotizador web no se toca); referidos = **código por cliente + cupón de premio**. Los montos
de referidos no están definidos por Tomás: se configuran en el admin y **parte apagado**.

- **Admin, Configuración → Marketing** (`MarketingConfiguration.tsx`; crear, activar y
  configurar es solo del perfil Administrador):
  - Programa de referidos: descuento para quien llega, premio para quien refirió, días de
    vigencia del premio, y encendido/apagado. No se puede encender sin los dos montos.
  - Cupones de campaña: código, % o monto fijo, usos máximos, monto mínimo, vigencia y
    nota interna. Cada cliente lo usa una vez. No se editan: se desactivan y se crea otro.
  - Lista de cupones, códigos de referido y premios, con sus usos.
- **Panel del cliente**:
  - Al reservar una cotización (`QuoteCard`): campo «¿Tienes un cupón o código de
    referido?». Muestra el descuento y los montos nuevos; el servidor lo vuelve a validar
    al reservar (`/api/cuenta/cupones` solo consulta, 20 intentos cada 15 min).
  - «Beneficios» (`/mi-cuenta/beneficios`): el código de referido (se crea solo la primera
    vez, con el programa encendido), cuántos reservaron con él, y los cupones de premio.
- **Cómo se aplica** (`src/lib/coupons.ts`): el descuento va sobre el precio de la
  cotización ANTES del abono del 50% o del pago completo con 5%; la pre-reserva nace con
  el precio rebajado, así Flow, el saldo y el admin no cambian. El precio final no puede
  quedar bajo $60.000 (dos veces el abono mínimo). El uso queda en `coupon_redemptions`
  y aparece en el historial de la reserva.
- **Un uso cuenta** cuando la reserva se pagó, no está cancelada y sigue al precio con
  descuento. Un cupón en una pre-reserva que nunca se pagó no gasta un uso ni premia.
- **Referidos**: el código no lo puede usar su dueño; solo sirve en el primer servicio de
  quien llega. El premio se entrega cuando ese servicio queda «completado» — sin proceso
  de fondo: se revisa al abrir «Beneficios» o Marketing del admin.
- **No incluido**: cupón en el cotizador web; aplicar un cupón desde el admin al armar una
  reserva; avisar por correo que se ganó un premio.
- **Sin probar con datos reales**: falta la migración y el login.

### Paso 9 — Ver cada perfil desde el admin (hecho, commit 4d9b5ff)

Sin migración.

- **«Ver su panel»** en tres lugares del admin: cada fila de **Clientes**, cada persona en
  la ficha de una **Empresa** (el encargado muestra el panel empresa) y cada trabajador en
  **Flota**. Abre `/mi-cuenta` o `/trabajos` en una pestaña nueva, con una franja amarilla
  «Vista de administrador · solo lectura» y un botón para salir.
- **No se presta la sesión de la persona** (`src/lib/adminPreview.ts`): es una cookie
  aparte, `admin_preview`, firmada, de 30 minutos, que solo entrega
  `POST /api/admin/preview` y que al leerse exige además una sesión de admin viva en el
  mismo navegador. Solo la usan las PÁGINAS para decidir de quién son los datos.
- **Solo lectura de verdad** (`src/middleware.ts`): mientras el navegador tenga esa
  cookie, toda llamada a `/api/cuenta/*` y `/api/trabajos/*` responde 403. Desde la vista
  no se paga, no se reprograma, no se sube ni se registra nada — ni a nombre de la persona
  ni con la sesión propia que el admin pudiera tener abierta. Probado: 403 en cinco rutas
  con la cookie presente; una cookie falsa o sin sesión de admin no abre ningún panel.
- **Efecto secundario a saber**: durante la vista, en ese navegador tampoco funcionan los
  links de documentos del panel ni entrar como cliente o trabajador. Se arregla con
  «Salir de la vista» (o esperando los 30 minutos).
- Cada apertura queda en Actividad (`preview.opened`).

## Estado de la etapa 2 (03-10-2026)

Los 9 pasos están construidos en `feat/perfil-del-cliente`, sin push ni merge. Cada uno
pasó `tsc` y `next build`; **ninguno se probó de punta a punta con datos reales** (la base
es de solo lectura para el agente y el admin necesita login). Antes de fusionar a `main`:

1. Reiniciar el servidor local y recorrer cada paso (la lista de pruebas está al final de
   cada sección de arriba).
2. Re-probar un link por camión `/trabajos/<token>` (su pantalla se movió a un componente
   común en el paso 4).
3. Facturación: cargar `EMISSO_API_KEY` y `EMISSO_CONNECTION_ID`, confirmar que la empresa
   de Tomás emite por el Facturador Gratuito, y hacer la primera vista previa.
4. Respuestas de Tomás que hoy están resueltas con valores por defecto: qué requiere
   aprobación, qué puede modificar el trabajador, montos de referidos, solicitudes desde
   el trabajador, avisos por correo o WhatsApp.
5. Traer a `main` el arreglo de `paymentSync` (464b5a5) y la rama `fix/una-casilla-politicas`.

## Cuenta empresa: quién ve y quién edita (regla del 06-10-2026)

Pedido de Francisco tras revisar Good life (EMP-00007). Reemplaza la regla anterior («el
miembro ve solo lo suyo»).

- El panel de empresa es la sección «Empresa» del panel del cliente (`/mi-cuenta/empresa`).
  Aparece en el menú de quien está asociado a una empresa, y un resumen sale también en el
  inicio de su cuenta.
- **Encargado:** ve todas las reservas asignadas a la empresa y puede pagarlas o cambiarles
  la fecha, las haya hecho quien las haya hecho. Ve además facturas y documentos.
- **Miembro:** ve todas las reservas de la empresa en solo lectura. No paga ni cambia fechas
  de ninguna, ni siquiera de las que hizo él. Sus reservas personales (sin empresa) siguen
  siendo suyas.
- El candado está en el servidor (`getEditableBookingRow` en `customerAccount.ts`): las rutas
  de pagar saldo y reprogramar lo usan, no solo la pantalla.
- Una ficha sin correo válido no puede entrar a su cuenta: se corrige en Clientes → ficha →
  Editar datos.
- **Historial completo:** las reservas de la empresa son las asignadas a ella MÁS las que
  hicieron sus personas y no están asignadas a ninguna empresa (`isCompanyBooking`). Así basta
  con asociar a la persona para que todo su historial aparezca. La facturación sigue usando
  solo las asignadas.
- Caso Good life (06-10-2026): Martín Arteaga tiene dos fichas. CL-000947 (correo inválido, es
  la que está en la empresa, 3 reservas) y CL-001109 (correo válido, fuera de la empresa, 11
  reservas). Sumando CL-001109 a la empresa el historial pasa de 3 a 14.


## Retomar una cotización (08-10-2026, rama `feat/retomar-cotizacion`)

Cierra el «No hecho» del Módulo 1. **Requiere `database/migrations/add_quote_state.sql`**
(aditiva). El cotizador (web y panel) guarda en `quote_prospects.quote_state` una copia de
lo cargado (`src/lib/quoteState.ts`); «Mi cuenta» muestra «Retomar cotización» en las que
la tienen y reabre el cotizador con todo puesto. El precio se recalcula con los valores
vigentes y una fecha ya pasada queda en blanco. Sin la migración todo sigue igual y el
botón no aparece. Las cotizaciones anteriores no se pueden retomar.

## Avisos por correo (08-10-2026, rama `feat/avisos-correo`)

Lo que solo se veía en el globo de «Por aprobar» ahora también llega por correo a
`ADMIN_NOTIFICATION_EMAIL` (`src/lib/teamNotices.ts`): solicitud nueva de un cliente o
empresa, y diferencia registrada por un trabajador en terreno. Quien refirió recibe un
correo cuando se le suman créditos (`referral_reward`). Salen por Resend, best-effort.
## Operación en terreno (09-10-2026, rama `feat/operacion-terreno`)

**Requiere `database/migrations/add_operacion_terreno.sql`** (aditiva). Pedidos de Tomás:

- **Iniciar y finalizar trabajo** (`src/lib/workLogs.ts`, `POST /api/trabajos/jornada`,
  `WorkerJobClock.tsx`): cada trabajador marca inicio y fin desde su panel, con fecha y hora.
  Ve los trabajos futuros, pero con uno iniciado y sin finalizar no puede iniciar otro; si
  igual necesita partir, confirma una advertencia y queda anotado (`started_with_open`). Es
  por trabajador y no cambia el estado de la reserva. Las marcas salen en el historial de la
  reserva del admin. Sin la migración los botones no aparecen.
- **N° de boleta o factura en los gastos**: obligatorio al rendir. Mismo N° y mismo monto =
  ya rendido, se rechaza; mismo N° con otro monto se acepta y el panel lo marca «N° repetido»
  (dos comercios pueden repetir numeración). Los gastos rechazados no cuentan.
- **m³ y personas en la solicitud**: obligatorios cuando es para la empresa, opcionales en
  una personal. Al aprobar pasan a la reserva (`volume_m3`, `people_needed`) si quien aprobó
  no los puso a mano.

## Editar empresa desde facturación y textos legales (09-10-2026, rama `feat/editar-empresa-y-politicas`)

- **Emisión de facturas → «Editar empresa»**: abre los datos de facturación de la empresa
  sin salir del panel (`CompanyDataEditor.tsx`, mismo formulario que la ficha de Empresas,
  ahora en `CompanyFields.tsx`). El perfil con Emisión de facturas puede guardar esa ficha;
  personas y reservas de la empresa siguen siendo del módulo Empresas.
- **Configuración → Políticas y términos** (`LegalConfiguration.tsx`, `src/lib/legalDocuments.ts`).
  **Requiere `database/migrations/add_legal_documents.sql`** (aditiva). Edita el texto de
  «Políticas de Garantía» y «Términos y Condiciones»; las páginas muestran lo guardado y,
  si no hay nada, el texto original del código. «Partir del texto publicado» trae al
  editor lo que hoy se ve. El cotizador y los correos enlazan a esas páginas, así que no
  hay otro lugar que cambiar. Lo escrito se pinta como elementos de React, nunca como HTML.

## Historial de trabajos (13-10-2026, rama `feat/historial-trabajos`)

Sin migraciones. El panel Trabajos tiene dos vistas: «Por asignar» (la de siempre) e
«Historial» (`JobHistory.tsx`, `src/lib/jobHistory.ts`, `GET /api/admin/jobs/history`): todos
los trabajos realizados con su ID, buscables por texto (ID, cliente, teléfono, dirección),
camión, trabajador y fechas, de a 50 por página. Solo lectura; el ID abre la reserva.
