# Contabilidad en Finanzas (08-10-2026)

Pedido de Francisco: empezar a llevar la contabilidad en el panel, ahora que el SII (Emisso),
BancoEstado y Flow están conectados: cuánto IVA toca cada mes según las facturas, y cuánto se
les paga a los trabajadores por los trabajos hechos.

Finanzas quedó con tres vistas: **Resumen** (lo de siempre), **IVA y banco** y **Pago a
trabajadores**.

## IVA del mes — datos reales del SII

`src/lib/accounting.ts` → `getIvaMonth`. Lee el Registro de Compras y Ventas (RCV) por Emisso
(`sii.rcv.consultar` y `sii.rcv_totales.consultar`), solo lectura.

- **Débito** = IVA de facturas y notas de débito emitidas − notas de crédito + boletas (el SII
  las informa como un total del mes).
- **Crédito** = IVA de facturas y notas de débito recibidas y **registradas** − notas de crédito.
- **Resultado** = débito − crédito. Positivo: a pagar. Negativo: remanente a favor.
- Aparte, sin sumar: los pagos con tarjeta (tipo 48, pueden repetir ventas con boleta) y las
  compras que el SII tiene «pendientes» (todavía no dan crédito).

Medido el 08-10-2026 sobre la conexión «SII Yo me encargo»:

| Mes | Débito | Crédito | Resultado |
|---|---|---|---|
| 2026-08 | $979.714 | $525.484 | $454.230 a pagar |
| 2026-09 | $473.904 | $573.067 | $99.163 de remanente |
| 2026-10 (parcial) | $297.350 | $115.437 | $181.913 a pagar |

**Es una estimación.** El F29 real además considera el remanente de meses anteriores, PPM,
retenciones y compras sin derecho a crédito. No reemplaza al contador.

## Banco

`getBankMonth` lee movimientos y saldos ya sincronizados de BancoEstado
(`banco_estado.movimientos.consultar`, `banco_estado.saldos.consultar`). Leerlos no contacta
al banco. El 08-10-2026 se pidió la sincronización de octubre y septiembre: la de octubre
terminó bien pero trajo **0 registros** (igual que tres corridas anteriores), así que la
conexión entra al banco pero no encuentra cuentas o movimientos. Hay que revisarlo en Emisso.

## Flow

`getFlowMonth` consulta a Flow día por día los pagos del mes (su API no tiene consulta
mensual) y los cruza con el libro de cobros del panel (`booking_payments` con orden de Flow):
total pagado, comisión, neto a depositar, y las diferencias en ambos sentidos. Solo lectura.
No se pudo probar con datos reales desde desarrollo: el `.env.local` apunta al sandbox de Flow.

## Pago a trabajadores

`src/lib/workerPay.ts`. Por trabajador y período:

- **Trabajos realizados:** reservas reales con fecha hasta hoy, no canceladas, donde la persona
  iba (cuadrilla, o su camión habitual). No se exige el estado «completada».
- **Regla de pago**, configurable: un **monto fijo** por trabajo o un **porcentaje** del valor
  del servicio (con IVA).
  - Regla general: Configuración → Pago a trabajadores (`worker_pay_config`).
  - Regla propia de un trabajador: Finanzas → Pago a trabajadores → «Cómo se le paga»
    (`workers.pay_per_job` o `workers.pay_percent`). Manda sobre la general.
  - Si van dos personas al mismo trabajo, cada una gana según su regla: el porcentaje no se
    reparte.
- **Pagos:** se registran a mano (`worker_payments`); el panel no transfiere nada.
- Los trabajos sin nadie asignado se cuentan aparte: no se le pagan a nadie.

Migraciones (aditivas): `add_worker_pay.sql` y `add_worker_pay_config.sql`.

## Variables del servidor

| Variable | Para qué | Valor |
|---|---|---|
| `EMISSO_CONNECT_API_KEY` | Hablar con Emisso | ya cargada |
| `EMISSO_CONNECTION_ID` | Conexión del SII de Yo me encargo (IVA y emisión de facturas) | `conn_yvyb9f0oof6siohhz9p1v` |
| `EMISSO_BANK_CONNECTION_ID` | Conexión de BancoEstado | `conn_j49vl4e8fo8cia9zq83fq` (confirmar que es la cuenta de Yo me encargo) |

Los ids salen de `GET https://connect.emisso.ai/api/v1/connections` con la key.

## Pendiente

- Conciliar cobros de Flow y abonos del banco contra reservas y facturas (necesita el banco
  sincronizado).
- Confirmar con Tomás cómo se paga a los trabajadores: hoy el modelo es un monto fijo por trabajo.

## Pago por m³ y km, gastos y estado de resultados (10-10-2026, rama `feat/pago-m3-km`)

**Requiere `add_worker_pay_m3km.sql` y `add_company_expenses.sql`** (aditivas).

- **Regla «por m³ y km»** (`workerPayTypes.ts`, `workerPay.ts`): pesos por m³ + pesos por km,
  como regla general (Configuración → Pago a trabajadores) o propia de un trabajador. Los m³
  y km salen de la reserva (`volume_m3`, `distance_km`) y, si no están, de su cotización. El
  panel avisa cuántos trabajos no los tienen.
- **Lo que se le debe** a cada persona = trabajos + gastos que rindió y se le aprobaron (por
  la fecha del trabajo) + bonificaciones cargadas a mano (`worker_bonuses`).
- **Finanzas → Gastos** (`ExpensesPanel.tsx`, `company_expenses`): gastos de la empresa
  cargados a mano, con categoría e IVA anotado; abajo, los de trabajadores ya aprobados.
- **Finanzas → EERR** (`getIncomeStatement`): ingresos netos − pago a trabajadores − gastos
  de terreno − gastos de la empresa (netos de IVA). Por fecha del servicio. Es de gestión:
  no incluye depreciación, sueldos fuera del panel ni impuesto a la renta. Avisa cuando hay
  servicios sin documento definido o pago a trabajadores incompleto.

## Cruce con el banco y estado de los trabajos (11-10-2026, rama `feat/cruce-banco-y-estado-trabajos`)

- **Cruce con el banco** (`src/lib/bankReconciliation.ts`, `BankReconciliationCard.tsx`, dentro
  de Finanzas → EERR; `GET /api/admin/accounting/reconciliation?mes=`). Por mes calendario:
  - Ingresos: abonos del banco ↔ cobros del panel que no pasaron por Flow.
  - Gastos: cargos del banco ↔ gastos de la empresa y pagos registrados a trabajadores.
  Calza con monto idéntico y fechas a ≤ 4 días; cada movimiento se usa una vez. Solo lectura.
  Depende de que Emisso entregue movimientos de BancoEstado (al 11-10-2026 llega vacío).
- **Trabajos (admin)**: cada trabajo muestra «En curso» o «Finalizado» según lo que marcó el
  equipo, y en el detalle quién inició y finalizó y a qué hora. Sin migración nueva.

## Cierre de pagos y forma de pago de los gastos (12-10-2026, rama `feat/cierre-pagos`)

**Requiere `database/migrations/add_pay_closings.sql`** (aditiva). Pedido de Tomás del 11-10.

- **Gastos: contado o crédito, y reembolso.** Al rendir, el trabajador indica si pagó de su
  bolsillo (`contado`: hay que devolvérselo) o con medios de la empresa (`credito`: no se le
  debe nada). En «Por aprobar» se puede corregir y marcar «reembolsado». A lo que se le debe
  solo suman los de contado sin reembolsar; un gasto que quedó reembolsado por un cierre
  sigue contando, porque lo cubre el pago de ese cierre. Los gastos anteriores, sin el dato,
  se tratan como contado. El EERR cuenta todos como costo, sin importar quién los pagó.
- **Finanzas → Cierre de pagos** (`PayClosingPanel.tsx`): período (semana, mes o fechas),
  selección de funcionarios, historial de trabajo de cada uno con sus gastos y ajustes,
  glosa, y descarga en PDF (una página por funcionario) o CSV (`payStatementExport.ts`).
- **Ajustes antes de cerrar**: bonificación o descuento con motivo (`worker_bonuses`, ahora
  acepta negativos).
- **Cerrar** (`closeWorkerPeriods`): guarda en `worker_pay_closings` los totales, la glosa y
  una copia del detalle, y deja reembolsados los gastos de contado que entran. Un período
  cerrado no admite ajustes. **Reabrir** es solo del perfil Administrador (`users.manage`).
- No incluido por ahora (decisión de Francisco): Excel real y envío por correo al funcionario.

## Categorías de gasto propias y gastos de tres orígenes (12-10-2026, rama `feat/gastos-categorias`)

**Requiere `database/migrations/add_expense_categories.sql`** (aditiva). Idea de Francisco:
que Finanzas → Gastos sirva como registro contable de los gastos de Tomás.

- **Categorías**: las 11 del panel más las que se creen en Gastos (`expense_categories`).
  Quitar una creada la saca de la lista; los gastos que ya la usan la conservan.
- **Gastos de trabajadores**: cada uno recibe categoría en Gastos (`documents.expense_category`).
- **Cargos del banco sin registrar**: los cargos del mes que el cruce no calza con ningún
  gasto ni pago aparecen en Gastos con «Registrar como gasto», que precarga fecha, glosa y
  monto en el formulario. Una vez guardado calza solo y sale de la lista. Depende de que
  Emisso entregue movimientos.
- **Por categoría**: tabla que junta empresa y trabajadores; lo sin categorizar va destacado.

## EERR mes a mes (13-10-2026, rama `feat/eerr-mensual`)

Sin migraciones. Finanzas → EERR abre en «Mes a mes» (`MonthlyIncomeStatement.tsx`,
`getMonthlyIncomeStatement`, `GET /api/admin/accounting/income-statement?meses=N`): 3, 6 o 12
meses, uno por columna. Filas: ventas, IVA, ingresos netos; pago a trabajadores y gastos de
trabajadores; margen del servicio y su %; otros gastos por categoría; resultado y
rentabilidad; y el IVA del mes según el SII (débito, crédito, a pagar).

El IVA que se descuenta de las ventas es el débito del SII de ese mes cuando Emisso lo
entrega; si no, el de las reservas con documento marcado. Mezcla dos calendarios (servicio
vs. emisión), y la pantalla lo dice. «Un período» conserva la vista anterior con el cruce
del banco.

## PDF oficial de la factura (13-10-2026, rama `feat/factura-pdf`)

Sin migraciones. Una factura emitida ofrece su PDF además del XML: es el documento oficial
del Facturador Gratuito del SII, que Emisso entrega con `sii.dte.descargar` por tipo, folio y
fecha (`getInvoicePdf`, `GET /api/admin/invoices/<id>/pdf`, `?descargar=1` para bajarlo). No se
guarda: se pide cada vez y se verifica con su SHA-256. Al emitir, la ficha de facturación
muestra un aviso con «Ver factura (PDF)». Botón «PDF» en Emisión de facturas y en la ficha.

## Pago por trabajos seleccionados y sueldo base (13-10-2026, rama `feat/pago-por-trabajo`)

**Requiere `database/migrations/add_payment_items.sql`** (aditiva). Pedido de Tomás.

- **Qué se paga en cada pago** (`worker_payment_items`): «Registrar pago» lista lo pendiente
  del período —trabajos, gastos por reembolsar, ajustes y sueldo base— con una casilla por
  ítem. Se paga lo marcado; lo demás queda para el pago siguiente. El monto lo calcula el
  servidor y cada ítem queda guardado con su monto. Un ítem no se puede pagar dos veces.
- **Seguimiento**: cada trabajo muestra «pagado dd-mm» y cada pago lista lo que cubrió. El
  saldo de un funcionario es la suma de sus ítems sin pagar.
- **Semanal**: el panel abre en la semana en curso.
- **Sueldo base** (`workers.pay_base`): monto mensual por funcionario, o sin base. Aparece
  como un ítem pagable por cada mes que toca el período, una vez por mes. En el EERR cuenta
  en el período en que termina su mes.
- Los gastos que entran en un pago quedan reembolsados, atados a ese pago.

## Fotos subidas sin monto y archivos en «Ver como» (14-10-2026, rama `feat/gastos-desde-fotos`)

Sin migraciones.

- **«Archivos dañados» en la vista de administrador**: no estaban dañados. «Ver como» bloquea
  todo `/api/trabajos/*`, también la descarga, y el navegador guardaba el JSON del error con
  nombre de foto. Ahora abrir un archivo del trabajador que se mira (GET de
  `/api/trabajos/documentos/<id>`) sí pasa; todo lo demás sigue bloqueado.
- **Registrar como gasto**: varios trabajadores subieron comprobantes como «foto» o
  «documento» y no como gasto, así que quedaron sin monto y fuera de la bandeja. «Por aprobar»
  → Gastos lista esos archivos (últimos 120 días) con «Registrar como gasto»: nombre, monto,
  contado o crédito y N° opcional. El archivo es el mismo; queda como gasto por aprobar.
