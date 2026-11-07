-- Migration: cotizaciones guardadas sin enviar (borradores del panel)
-- Date: 2026-10-20
-- Rama: feat/cotizacion-guardar-editar. Pedido de Francisco: «en Nueva cotización poder
-- guardar la cotización».
--
-- QUÉ AGREGA
--   quote_prospects.is_draft   true = la cotización se guardó desde el panel SIN enviarla.
--                              Mientras sea borrador no recibe los correos automáticos de
--                              cotización (el cliente no la ha visto). Al enviarla deja de
--                              ser borrador.
--
-- ES SOLO ADITIVA. Se puede correr dos veces. Sin ella, «Guardar sin enviar» avisa que falta.

ALTER TABLE quote_prospects ADD COLUMN IF NOT EXISTS is_draft BOOLEAN NOT NULL DEFAULT FALSE;
