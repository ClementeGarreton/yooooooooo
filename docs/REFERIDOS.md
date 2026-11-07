# Referidos y créditos (modelo de AppleFix, 1 crédito = 1 CLP)

Pedido de Francisco (06-10-2026): copiar el sistema de referidos que ya funciona en AppleFix
(Ordenox, `Referidos_model.php`), con códigos únicos por cliente, pero con 1 token = 1 CLP.

## Qué se copió de AppleFix

| Regla de AppleFix | En Yo me encargo |
|---|---|
| Cada cliente **atendido** (al menos un servicio pagado) tiene su código | Igual: el código aparece en Beneficios después del primer servicio pagado |
| Código fácil de decir: nombre de pila + 4 caracteres (`CAMILA-7KQ2`) | Igual, sin guion (`CAMILA7KQ2`); se puede escribir con o sin guion |
| El código se canjea en la orden, lo aplica quien atiende | Nuevo: «Código de referido o cupón» en el detalle de la reserva. También sigue en el panel del cliente |
| Nada se gana al aplicar; cuenta cuando la orden está **cobrada** | Igual: los créditos se entregan cuando la reserva tiene un pago y no está cancelada |
| Tokens = floor(monto pagado / pesos por token) | Igual (`pesos_per_token`), sobre el valor vigente del servicio |
| Descuento del referido en % con tope en pesos | Igual (`referred_cap`); además se mantiene la opción de monto fijo |
| «Solo clientes nuevos», configurable | Igual (`only_new`) |
| No se puede usar el código propio, ni el de una ficha con el mismo RUT | Igual |
| Una persona llega referida una sola vez | Igual |
| El portal muestra a los referidos con nombre corto y su estado | Igual: seguimiento en dos pasos (usó el código → pagó) |

## Qué es distinto, a propósito

- **1 crédito = $1.** En AppleFix los tokens se canjean por premios de un catálogo y hay tramos
  por cantidad de referidos. Acá no hay catálogo ni tramos: el cliente retira sus créditos en
  plata (carga sus datos de transferencia, aprieta «Retirar» y a Yo me encargo le llega el aviso).
- Por eso lo ganado sí se anota en un libro (`customer_credit_movements`): es plata que se debe.

## Configuración (Marketing → Cupones y referidos)

- Descuento para quien llega referido (porcentaje o monto) y su tope en pesos.
- Pesos pagados que dan 1 crédito. Con 20, quien refiere gana el 5 % de lo que pague su referido.
- Solo clientes nuevos.
- Encendido / apagado. El programa sigue **apagado** hasta que se definan los valores.

## Base de datos

`database/migrations/add_referral_rules.sql` (aditiva): `marketing_config.referred_cap`,
`only_new`, `pesos_per_token`. Se suma a `add_coupons.sql` y `add_referral_credits.sql`.

## No copiado (queda propuesto)

- El bloque con el código de referido dentro de los correos posteriores al servicio.
- El análisis de costo del programa que tiene AppleFix en su configuración.
