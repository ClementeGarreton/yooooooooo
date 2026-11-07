-- Migration: copiar a las reservas las fotos que el cliente subió en el cotizador
-- Date: 2026-10-27
-- Rama: fix/fotos-cotizador (#72). Tomás (27-10-2026): «las fotos que mandan los clientes por
-- el cotizador no se visualizan». Las fotos quedaban solo en quote_prospects.quote_state y la
-- reserva no las recibía si se creaba desde el panel o sobre una pre-reserva anterior.
--
-- QUÉ HACE
--   Para cada reserva SIN fotos (photo_urls vacío o nulo) cuya cotización (mismo quote_id)
--   tiene fotos, copia esas fotos a bookings.photo_urls. Si hay más de una cotización con el
--   mismo quote_id, toma la más nueva.
--
-- No toca reservas que ya tienen fotos ni las cotizaciones. Se puede correr dos veces: la
-- segunda no encuentra nada que copiar. Desde el #72 las reservas nuevas ya las reciben solas.
--
-- Para ver antes qué reservas cambian, correr solo el SELECT de abajo.

-- SELECT b.code, jsonb_array_length(q.photos) AS fotos
-- FROM bookings b
-- JOIN (
--   SELECT DISTINCT ON (quote_id) quote_id, quote_state->'additionalServices'->'photos' AS photos
--   FROM quote_prospects
--   WHERE quote_id IS NOT NULL
--     AND jsonb_typeof(quote_state->'additionalServices'->'photos') = 'array'
--     AND jsonb_array_length(quote_state->'additionalServices'->'photos') > 0
--   ORDER BY quote_id, created_at DESC
-- ) q ON q.quote_id = b.quote_id
-- WHERE b.photo_urls IS NULL OR b.photo_urls = '[]'::jsonb OR b.photo_urls = 'null'::jsonb;

UPDATE bookings b
SET photo_urls = q.photos
FROM (
  SELECT DISTINCT ON (quote_id) quote_id, quote_state->'additionalServices'->'photos' AS photos
  FROM quote_prospects
  WHERE quote_id IS NOT NULL
    AND jsonb_typeof(quote_state->'additionalServices'->'photos') = 'array'
    AND jsonb_array_length(quote_state->'additionalServices'->'photos') > 0
  ORDER BY quote_id, created_at DESC
) q
WHERE b.quote_id = q.quote_id
  AND (b.photo_urls IS NULL OR b.photo_urls = '[]'::jsonb OR b.photo_urls = 'null'::jsonb);
