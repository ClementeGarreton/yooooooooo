# Mejoras de octubre 2026 (notas de Tomás del 04-10-2026)

Rama `feat/mejoras-tomas-oct`, sobre `main` después de fusionar el rediseño del admin (PR #7).

## Hecho

1. **Notas del chofer editables.** Quien escribió una nota desde un link de camión (o desde su
   sesión de trabajador) puede corregirla: botón «Editar» en sus propias notas.
   `PATCH /api/trabajos/notes`. No se editan las notas de otro camión o de otra persona.
2. **Gastos con nombre y monto.** En el panel del trabajador un gasto pide nombre (peaje,
   bencina…) y monto, y es un comprobante por gasto. El nombre se guarda en `documents.note`.
3. **Gastos de trabajadores por aprobar.** En «Por aprobar» hay una sección con los gastos:
   ver comprobante, aprobar o rechazar con motivo. Suma al globo del menú. El trabajador ve
   el estado (y el motivo) en su panel. Migración `add_expense_review.sql`.
4. **Editar datos del cliente.** En la ficha (Clientes → nombre): «Editar datos» cambia nombre
   y teléfono. El correo no se edita porque es la identidad de la persona.
5. **Finanzas: ingresos por documento tributario.** Tabla con factura / boleta / sin
   documento / sin definir (servicios, total, neto, IVA, cobrado, por cobrar), totales con y
   sin documento, e «IVA a pagar por documentos del mes». El IVA es total ÷ 1,19 de los
   servicios con factura o boleta, por fecha del servicio. Las filas suman lo mismo que
   «Reservado» (verificado en 2026-08, 09 y 10).
6. **Referidos con créditos.** Migración `add_referral_credits.sql`.
   - Dos pasos por referido: (1) usó el código al cotizar, (2) pagó. Se ven en el panel del
     cliente (Beneficios) y en el admin (Marketing → Cupones y referidos).
   - Al completarse el paso 2, quien refirió gana créditos (1 crédito = 1 CLP). El monto
     sale de la configuración de referidos: monto fijo, o porcentaje de lo que pagó el referido.
   - Retiro: el cliente carga sus datos de transferencia (titular, RUT, banco, tipo y número
     de cuenta) y aprieta «Retirar mis créditos». Sin datos no puede. Se descuenta su saldo,
     queda un retiro «solicitado» y sale un correo a `ADMIN_NOTIFICATION_EMAIL`.
   - En el admin: lista de retiros con los datos bancarios; «Marcar transferido» o
     «Rechazar» (con motivo; los créditos vuelven al saldo). Exige el permiso de Marketing.
   - Sin la migración, los referidos siguen premiando con cupón como antes.

## Segunda tanda (pedidos de Tomás del 04-10 por la noche)

7. **Inicio: filtro «Mañana».** Con «Hoy» se ve solo la lista de hoy, con «Mañana» solo la de
   mañana; con Semana, Mes o Rango se ven las tres como siempre.
8. **Inicio: cada reserva muestra direcciones, personas y asignación.** Origen → destino (o la
   dirección de la visita), quiénes están asignados, cuántas personas pide la cotización
   (`additional_services.totalCrew`) y «Asignar chofer y equipo», que marca trabajadores sin
   salir de Inicio (mismo camino que el panel Trabajos: avisa al trabajador).
9. **Comentarios en la ficha del trabajador.** En Flota y equipo → «Editar · comentarios»:
   historial con fecha y autor («se entrega carta de amonestación», «disponible de lunes a
   miércoles»). El trabajador no los ve. Migración `add_worker_comments.sql`. El correo del
   trabajador ya se podía cambiar en esa misma ventana.
10. **El equipo de cada trabajo en el panel del chofer.** En `/trabajos` (sesión personal y
    links por camión) cada trabajo muestra «Equipo de este trabajo» con los nombres de
    quienes van (cuadrilla + camión habitual); el nombre llama a su teléfono si lo tiene.

## Pendiente de definir

- **Conciliar facturas, Flow y BancoEstado.** No se construyó: hace falta decidir de dónde
  salen los movimientos del banco y de Flow (¿cartola en Excel/CSV subida a mano?, ¿reporte
  de Flow?) y contra qué se cruzan.
- **Código de referido en el cotizador público.** Hoy el código se usa desde el panel del
  cliente, al reservar una cotización. Si debe poder escribirse al cotizar en la web, es un
  cambio en el cotizador y en el precio que se muestra.

## Decisiones tomadas por defecto (confirmar con Tomás)

- «Pagó» = la reserva tiene un pago registrado (abono incluido), no está cancelada y sigue al
  precio con descuento. Si después se cancela, los créditos ya entregados no se quitan solos.
- El retiro es siempre por todo el saldo, sin mínimo.
- El referido sigue recibiendo su descuento configurado en Marketing.
- El aviso de retiro sale por Resend: en producción necesita `RESEND_API_KEY` (n8n no conoce
  ese correo). Sin la key el retiro igual queda registrado y visible en Marketing.
