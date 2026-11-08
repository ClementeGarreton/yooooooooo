-- Auditoría de revisión de precios por cotización (NO modifica la tarifa global).
ALTER TABLE quote_prospects ADD COLUMN IF NOT EXISTS price_review JSONB;
ALTER TABLE quote_prospects ADD COLUMN IF NOT EXISTS price_reviewed_at TIMESTAMPTZ;
