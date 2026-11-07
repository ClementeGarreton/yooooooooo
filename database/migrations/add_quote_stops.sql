-- Migration: paradas intermedias en la cotización
-- Date: 2026-09-02
-- Punto 5 de la reunión del 1-sep: "agregar + de una dirección de transporte al
-- cotizador web (paradas por lugares etc)".
--
-- QUÉ SON
-- Direcciones INTERMEDIAS entre el origen y el destino: el camión sale del origen, pasa
-- por cada parada en orden, y termina en el destino. Sirve tanto para cargar algo en el
-- camino como para dejar algo antes del destino final — operativamente es lo mismo, y
-- por eso cada parada lleva su propia nota para que el chofer sepa qué hace ahí.
--
-- POR QUÉ JSONB Y NO COLUMNAS NUEVAS
-- `bookings` tiene exactamente DOS direcciones (origin_ y destination_), cada una con sus
-- cuatro campos de piso/ascensor/acarreo. Agregar una tercera en columnas obligaría a una
-- cuarta cuando alguien pida dos paradas. Como la cantidad es variable, va una lista.
--
-- FORMA DE CADA PARADA (misma que usa el store del cotizador, para no traducir):
--   { "street": "...", "number": "...", "commune": "...", "region": "...",
--     "additionalInfo": "...", "note": "qué se hace en esta parada" }
--
-- La distancia SÍ cambia: pasa de ser origen→destino a la suma de los tramos. Eso ya
-- estaba cobrado por `pricePerKilometer` sobre los km que pasan de los gratis, así que
-- una mudanza con paradas cuesta más sin tocar la tabla de precios.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS stops JSONB;

ALTER TABLE quote_prospects
  ADD COLUMN IF NOT EXISTS stops JSONB;

COMMENT ON COLUMN bookings.stops IS
  'Paradas intermedias en orden, entre origen y destino. Lista JSON; NULL o [] = viaje directo.';
COMMENT ON COLUMN quote_prospects.stops IS
  'Paradas intermedias en orden, entre origen y destino. Lista JSON; NULL o [] = viaje directo.';
