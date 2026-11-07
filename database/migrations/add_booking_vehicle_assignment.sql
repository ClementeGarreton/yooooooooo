-- Asignación de cada reserva a un camión de la flota + color estable por camión.
--
-- Los camiones viven en fleet_config.vehicles (JSONB) y su `id` es un entero estable,
-- por eso aquí se guarda el id plano y no una FK: no existe una tabla de vehículos.
-- vehicle_id NULL = sin asignar; en el link de choferes cae en el grupo "Sin asignar".

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS vehicle_id INTEGER;

-- Toda consulta es "trabajos de un rango de fechas, agrupados por camión".
CREATE INDEX IF NOT EXISTS idx_bookings_date_vehicle
  ON bookings (scheduled_date, vehicle_id);

-- Color estable por camión, guardado en fleet_config.vehicles[].color. Sin esto el color
-- se derivaría de la posición en la lista y cambiaría al borrar un camión del medio, que
-- es justo lo que rompe la referencia visual para los choferes.
--
-- Estructura de cada elemento de `vehicles` después de esta migración:
--   { "id": number, "name": string, "capacity": number, "driver": string,
--     "phone": string, "status": "active" | "maintenance", "color": string }
UPDATE fleet_config
SET vehicles = (
  SELECT jsonb_agg(
    CASE
      WHEN v ? 'color' AND v->>'color' <> '' THEN v
      ELSE v || jsonb_build_object(
        'color',
        (ARRAY['azul','verde','ambar','violeta','rosa','cian','naranja','lima'])[((ord - 1) % 8) + 1]
      )
    END
    ORDER BY ord
  )
  FROM jsonb_array_elements(vehicles) WITH ORDINALITY AS t(v, ord)
)
WHERE jsonb_typeof(vehicles) = 'array' AND jsonb_array_length(vehicles) > 0;
