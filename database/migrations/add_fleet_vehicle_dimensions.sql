-- Dimensiones de cada camión, dentro del JSONB de fleet_config.vehicles.
--
-- No hace falta ALTER TABLE: `vehicles` ya es JSONB y las claves nuevas se guardan solas
-- desde el panel. Este backfill existe para que todos los camiones tengan los campos
-- presentes (en 0) y el formulario no arranque con inputs vacíos que parecen rotos.
--
-- Estructura de cada elemento de `vehicles` después de esta migración:
--   { "id": number, "name": string, "capacity": number, "driver": string,
--     "phone": string, "status": "active" | "maintenance", "color": string,
--     "length": number, "width": number, "height": number, "maxWeight": number }
--
-- length / width / height van en METROS; maxWeight en KILOS. El volumen útil (m³) se
-- calcula en el panel, no se guarda, para que no pueda quedar desincronizado.

UPDATE fleet_config
SET vehicles = (
  SELECT jsonb_agg(
    v
      || jsonb_build_object('length',    COALESCE((v->>'length')::numeric, 0))
      || jsonb_build_object('width',     COALESCE((v->>'width')::numeric, 0))
      || jsonb_build_object('height',    COALESCE((v->>'height')::numeric, 0))
      || jsonb_build_object('maxWeight', COALESCE((v->>'maxWeight')::numeric, 0))
    ORDER BY ord
  )
  FROM jsonb_array_elements(vehicles) WITH ORDINALITY AS t(v, ord)
)
WHERE jsonb_typeof(vehicles) = 'array' AND jsonb_array_length(vehicles) > 0;
