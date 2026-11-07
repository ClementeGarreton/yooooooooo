-- Migration: ficha de cada camión — patente, marca y kilometraje
-- Date: 2026-10-04
-- Rama: feat/admin-rediseno.
--
-- La flota vive en `fleet_config.vehicles` (un JSON). Estos datos NO van ahí a propósito:
-- el panel que está hoy en producción reescribe ese JSON entero cada vez que alguien
-- guarda la flota, y borraría cualquier campo que no conozca. En una tabla aparte, la
-- patente y el kilometraje sobreviven aunque se guarde la flota desde la versión vieja.
--
-- QUÉ AGREGA
--   vehicle_details -> una fila por camión (por su `id` dentro de fleet_config.vehicles):
--     plate        patente
--     brand        marca y modelo
--     odometer_km  último kilometraje LEÍDO del tablero y cargado a mano
--     odometer_at  fecha de esa lectura. Desde ese día el panel le suma los kilómetros
--                  de los trabajos del camión para estimar el kilometraje de hoy.
--
-- ES SOLO ADITIVA: no toca nada que use `main`. Se puede correr dos veces.
-- RLS activo y CERO policies, igual que el resto (ver enable_rls_all_tables.sql).

CREATE TABLE IF NOT EXISTS vehicle_details (
  vehicle_id INTEGER PRIMARY KEY,
  plate TEXT,
  brand TEXT,
  odometer_km INTEGER CHECK (odometer_km IS NULL OR odometer_km >= 0),
  odometer_at DATE,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE vehicle_details IS
  'Patente, marca y última lectura de kilometraje de cada camión de fleet_config.vehicles.';

ALTER TABLE vehicle_details ENABLE ROW LEVEL SECURITY;
