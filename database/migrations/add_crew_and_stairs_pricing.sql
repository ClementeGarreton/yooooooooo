-- Cuadrilla y escaleras: las dos reglas de precio que dependen de CÓMO se carga.
--
-- CUADRILLA. Antes el peso de los artículos solo se sumaba para mostrar un total
-- informativo; nunca se cobraba. Ahora define cuánta gente hace falta, y la define el
-- bulto MÁS PESADO, no la suma: tres muebles de 60 kg se cargan de a uno y necesitan las
-- mismas dos personas, pero uno solo de 200 kg necesita cuatro.
--   personas = techo(peso_del_bulto_mas_pesado / kg_per_person), mínimo included_people
--
-- ESCALERAS. El cargo por piso era plano (piso × tarifa), o sea que subir un velador a un
-- 3º costaba lo mismo que subir treinta bultos. Ahora se multiplica por los viajes:
--   viajes = techo(cantidad_de_bultos / items_per_trip)

ALTER TABLE pricing_config
  ADD COLUMN IF NOT EXISTS crew_config JSONB NOT NULL DEFAULT
    '{"includedPeople": 1, "kgPerPerson": 50, "pricePerExtraPerson": 20000, "maxPeople": 10}'::jsonb;

ALTER TABLE pricing_config
  ADD COLUMN IF NOT EXISTS stairs_config JSONB NOT NULL DEFAULT
    '{"itemsPerTrip": 5}'::jsonb;

COMMENT ON COLUMN pricing_config.crew_config IS
  'includedPeople: personas ya incluidas en el precio base (el chofer). kgPerPerson: cada '
  'tramo de estos kilos EN UN MISMO BULTO suma una persona. pricePerExtraPerson: precio de '
  'cada persona por sobre las incluidas, igual para la obligatoria por peso y para el '
  'ayudante que pide el cliente. maxPeople: tope del selector del paso 6.';

COMMENT ON COLUMN pricing_config.stairs_config IS
  'itemsPerTrip: cada tantos bultos se repite el cargo por piso (un viaje más de escalera).';
