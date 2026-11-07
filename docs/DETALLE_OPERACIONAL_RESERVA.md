# Detalle operacional de la reserva (feedback de Tomás, 06-10-2026)

Rama `feat/detalle-operacional-reserva`. Objetivo: abrir una reserva y entender el trabajo
completo en segundos, y cambiar el camión sin salir de ahí.

## Auditoría: qué pasaba

- El detalle de la reserva (Reservas → nombre u ojo) mostraba cliente, fecha, direcciones,
  volumen y plata, pero **no** mostraba: camión, personas requeridas, peonetas, distancia,
  duración, peso, servicios adicionales, indicaciones del cliente ni distancia del
  estacionamiento. La cuadrilla estaba al final de la ventana, después de fotos y documentos.
- Nada de eso se «perdió» de la base. La lista de Reservas ya recibe esos campos (vienen de la
  cotización enlazada); el detalle simplemente no los dibujaba. El rediseño del panel no quitó
  campos de la lista (se comparó contra la versión anterior a PR #7).
- **Cambio de camión:** se hacía en Editar (lápiz) → ventana larga → bajar hasta el selector →
  Guardar. Desde el detalle (ojo) el camión ni siquiera se veía. Sí había selector en Inicio y
  en Trabajos, pero no en Reservas.

## Dónde vive cada dato

| Dato | Estado | Dónde |
|---|---|---|
| Origen, destino, paradas, piso y ascensor | A: existía, visible pero suelto | `bookings` |
| Distancia estacionamiento–puerta | A: existía, no se mostraba | `bookings.*_parking_distance` |
| Distancia (km), volumen, peso | B: en la cotización | `quote_prospects.total_distance / total_volume / total_weight` |
| Personas requeridas, ayudantes extra | B: en la cotización | `quote_prospects.additional_services.totalCrew / extraHelpers` |
| Vehículo recomendado | B: en la cotización | `quote_prospects.recommended_vehicle` |
| Servicios (embalaje, desarme…) e indicaciones del cliente | B: en la cotización | `additional_services` |
| Camión asignado | A: existía, no se mostraba en el detalle | `bookings.vehicle_id` |
| Cuadrilla asignada | A: existía, al final del detalle | `booking_workers` + camión habitual |
| Duración estimada | A: existía, no se mostraba | `bookings.duration_hours` |
| Valor y pagos | A: visible | `bookings` |
| Personas requeridas en reservas cargadas a mano | **D: nunca se guardó** | campo nuevo |
| «Escaletas / pasos» | D: no existe ni existió | ver abajo |

Cobertura medida el 06-10-2026 sobre las 175 reservas reales desde el 01-08-2026 (101 cargadas
a mano): duración 100 %, camión 90 %, origen y destino 70 %, volumen / distancia / peso 37 %,
personas 26 %, piso 22 %, indicaciones del cliente 7 %. Lo que falta es casi todo de reservas
cargadas a mano, que no tienen cotización.

**«Escaletas» = escaleras** (aclarado por Francisco el 06-10-2026): los pisos de cada punto y si
hay ascensor. Va como fila propia «Acceso origen» / «Acceso destino» («Piso 5 · SIN ascensor:
por escaleras», en rojo) y como aviso rojo en la franja de arriba cuando algún punto es por
escaleras. Lo que la base NO guarda es si, habiendo ascensor, la carga igual tiene que ir por
la escalera porque no cabe: solo existe «tiene / no tiene ascensor».

## Qué cambió

- `BookingOperationalSummary` (nuevo) al inicio del detalle, en seis grupos: Ruta, Recursos,
  Carga, Operación, Comercial e Indicaciones, más una franja «de un vistazo» con distancia ·
  m³ · personas · camión · duración · valor. La ventana pasó a tamaño ancho.
- **Cambio de camión en el detalle:** selector con cada camión marcado «libre» u «ocupado
  HH:MM–HH:MM» para esa fecha, hora y duración. Usa la misma ruta de siempre
  (`PATCH /api/admin/bookings/<id>`): no cambia las reglas, queda en Actividad y avisa a los
  trabajadores. Si el camión elegido se pisa con otro trabajo, lo avisa (no lo bloquea, igual
  que antes).
- **Personas requeridas editables:** si la reserva no trae cotización, o Tomás quiere otro
  número, se indica a mano. Columna nueva `bookings.people_needed`.
- La cuadrilla se asigna dentro del mismo bloque de Recursos y dice cuántos faltan respecto de
  las personas requeridas.
- Se quitaron del detalle los datos sueltos que el resumen reemplaza (no se perdió ninguno).

## Base de datos

`database/migrations/add_booking_people_needed.sql` (aditiva): `bookings.people_needed`.
Sin ella todo funciona y el número a mano avisa que falta la migración.

## Archivos

- `src/components/admin/BookingOperationalSummary.tsx` (nuevo)
- `src/app/api/admin/bookings/[id]/operational/route.ts` (nuevo)
- `src/components/admin/BookingsManagement.tsx`, `BookingWorkers.tsx`
- `database/migrations/add_booking_people_needed.sql`

## Problemas adicionales vistos

- 101 de 175 reservas se cargan a mano y por eso no tienen volumen, distancia ni peso. El
  formulario «Nueva reserva» no pide esos datos.
- El 30 % de las reservas no tiene origen y destino completos.

## Muebles grandes por la escalera (06-10-2026)

Pedido de Francisco: una casilla en «Servicios adicionales» del cotizador para lo que, por
tamaño, no cabe en el ascensor.

- Cotizador (paso Servicios adicionales): casilla «Hay muebles grandes que deben ir por la
  escalera». **No cambia el precio**: es un aviso para el equipo.
- Se guarda en `quote_prospects.additional_services.stairsCarry` (JSON existente: sin
  migración). Las cotizaciones anteriores no lo traen y se leen como «no».
- Se ve en el resumen del cotizador, en el PDF del panel (también el de trabajadores) y en el
  detalle de la reserva: fila «Escaleras» en Ruta y aviso rojo en la franja de arriba.
- Las reservas cargadas a mano no pasan por el cotizador: ahí se anota en las notas internas.

## Datos operacionales en «Nueva reserva» (06-10-2026)

- El formulario de «Nueva reserva» ahora pide (opcional): piso y ascensor de origen y destino,
  personas (con chofer), volumen (m³) y distancia (km).
- Piso y ascensor ya tenían columna. Personas usa `bookings.people_needed`. Volumen y distancia
  no tenían dónde guardarse para una reserva a mano (su ficha de contacto se comparte por
  correo entre todas las reservas de la persona): columnas nuevas `bookings.volume_m3` y
  `bookings.distance_km`, migración `add_booking_manual_operational.sql`.
- En el detalle, volumen y distancia también se pueden indicar o corregir a mano.
- Lo puesto a mano manda sobre lo que diga la cotización.
- La columna de volumen de la LISTA de Reservas sigue mostrando solo el de la cotización.

