-- Migration: tope del descuento de un cupón
-- Date: 2026-10-15
-- Rama: fix/cupones-en-la-web. Campaña OCTUBRE: «Descuento máximo de $100.000».
--
-- QUÉ AGREGA
--   coupons.max_discount   tope en pesos del descuento de un cupón (un 20% de una mudanza
--                          de $800.000 descuenta $100.000, no $160.000). NULL = sin tope.
--
-- ES SOLO ADITIVA. Se puede correr dos veces. Sin ella los cupones funcionan igual, sin tope,
-- y el admin avisa que falta al intentar poner uno.

ALTER TABLE coupons ADD COLUMN IF NOT EXISTS max_discount INTEGER
  CHECK (max_discount IS NULL OR max_discount > 0);

-- Cupón OCTUBRE (respuestas de Tomás, 19-10-2026): 20% con tope de $100.000 de descuento,
-- servicios desde $50.000, vigente hasta el 25 de octubre.
UPDATE coupons
SET max_discount = 100000, min_amount = 50000, valid_until = '2026-10-25'
WHERE code = 'OCTUBRE';
