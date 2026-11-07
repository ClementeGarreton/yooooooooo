-- Migration: UF manual, mínimo de m³ para el pago y horario fijo
-- Date: 2026-10-22
-- Rama: feat/pendientes-tomas-21-10. Pendientes de Tomás (PDF del 21-10-2026):
--   6. «Lugar en el sistema donde actualizar el valor de la UF».
--   8. «Establecer una cantidad mínima de metros cúbicos al momento de cerrar un trabajo».
--  18. «Alerta para trabajos con horario fijo de entrega/retiro».
--
-- QUÉ AGREGA
--   app_settings                      ajustes sueltos del panel, uno por clave. Hoy: 'uf'
--                                     (valor de la UF puesto a mano; sin él se usa el del día).
--   worker_pay_config.min_m3          m³ mínimos con que se paga un trabajo por m³ (si el
--                                     trabajo tiene menos, se paga como si tuviera este mínimo).
--   bookings.fixed_time               el retiro o la entrega tiene hora fija: alerta al equipo.
--   service_requests.fixed_time       lo marcó el cliente al pedir; pasa a la reserva.
--
-- ES ADITIVA. Se puede correr dos veces.

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE worker_pay_config ADD COLUMN IF NOT EXISTS min_m3 NUMERIC
  CHECK (min_m3 IS NULL OR min_m3 >= 0);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS fixed_time BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS fixed_time BOOLEAN NOT NULL DEFAULT FALSE;
