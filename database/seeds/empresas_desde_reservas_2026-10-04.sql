-- Datos: empresas que YA son clientes, tomadas de las reservas del panel
-- Date: 2026-10-04 · Rama: feat/admin-rediseno · Requiere add_panel_perfiles_fase2.sql
--
-- De dónde salen: las 6 reservas reales (no canceladas, no pre-reservas) marcadas
-- «empresa» con un RUT de dígito verificador válido. Consulta de solo lectura del
-- 04-10-2026. La razón social va TAL CUAL la escribió el cliente al reservar.
--
-- Por cada una:
--   1) crea la empresa (si ya existe una con ese RUT, no la toca);
--   2) asocia como ENCARGADO a la persona que hizo la reserva (solo si no tiene empresa);
--   3) asigna esa reserva a la empresa (solo si no está asignada a ninguna).
-- Giro, dirección, comuna y ciudad quedan vacíos: no están en las reservas y hacen falta
-- antes de facturar (se completan en la ficha de la empresa).
--
-- Se puede correr dos veces. No borra ni pisa nada.

-- Transportes Gatmar spa · 77873208-4 · reserva RES-000283 · CL-001113
INSERT INTO companies (razon_social, rut, notes)
VALUES ('Transportes Gatmar spa', '77873208-4', 'Creada desde la reserva RES-000283 (04-10-2026). Faltan los datos de facturación.')
ON CONFLICT (rut) DO NOTHING;

UPDATE customers SET company_id = (SELECT id FROM companies WHERE rut = '77873208-4'), company_role = 'encargado', updated_at = NOW()
WHERE id = '582da51d-e676-4815-8751-3520e53df604' AND company_id IS NULL;

UPDATE bookings SET company_id = (SELECT id FROM companies WHERE rut = '77873208-4')
WHERE id = 'c1beb06f-b432-4ba0-ab4b-6e5daacf65d9' AND company_id IS NULL;

-- ASESORIAS CAPACITO SPA · 77008953-0 · reserva RES-000133 · CL-000639
INSERT INTO companies (razon_social, rut, notes)
VALUES ('ASESORIAS CAPACITO SPA', '77008953-0', 'Creada desde la reserva RES-000133 (04-10-2026). Faltan los datos de facturación.')
ON CONFLICT (rut) DO NOTHING;

UPDATE customers SET company_id = (SELECT id FROM companies WHERE rut = '77008953-0'), company_role = 'encargado', updated_at = NOW()
WHERE id = '0efd1bb2-196f-43cb-8576-3ff056f06091' AND company_id IS NULL;

UPDATE bookings SET company_id = (SELECT id FROM companies WHERE rut = '77008953-0')
WHERE id = 'd37ed011-4414-46a1-9206-a7c1cdcee2e0' AND company_id IS NULL;

-- Asesoría legal Ansia Creativa SpA · 77896499-6 · reserva RES-000125 · CL-000800
INSERT INTO companies (razon_social, rut, notes)
VALUES ('Asesoría legal Ansia Creativa SpA', '77896499-6', 'Creada desde la reserva RES-000125 (04-10-2026). Faltan los datos de facturación.')
ON CONFLICT (rut) DO NOTHING;

UPDATE customers SET company_id = (SELECT id FROM companies WHERE rut = '77896499-6'), company_role = 'encargado', updated_at = NOW()
WHERE id = 'b7261715-523b-4d07-8a68-b63e898aa36f' AND company_id IS NULL;

UPDATE bookings SET company_id = (SELECT id FROM companies WHERE rut = '77896499-6')
WHERE id = '8023e7a7-6362-4473-b66b-cb7feb2a4169' AND company_id IS NULL;

-- viared computacion spa · 78112650-0 · reserva RES-000055 · CL-000356
INSERT INTO companies (razon_social, rut, notes)
VALUES ('viared computacion spa', '78112650-0', 'Creada desde la reserva RES-000055 (04-10-2026). Faltan los datos de facturación.')
ON CONFLICT (rut) DO NOTHING;

UPDATE customers SET company_id = (SELECT id FROM companies WHERE rut = '78112650-0'), company_role = 'encargado', updated_at = NOW()
WHERE id = '08f9b35e-4822-42f1-933e-4216ae80ff71' AND company_id IS NULL;

UPDATE bookings SET company_id = (SELECT id FROM companies WHERE rut = '78112650-0')
WHERE id = '47ee19c0-9aed-4b97-81d0-0acc18fee183' AND company_id IS NULL;

-- sociedad comercial pethome spa · 76486342-9 · reserva RES-000042 · CL-000526
INSERT INTO companies (razon_social, rut, notes)
VALUES ('sociedad comercial pethome spa', '76486342-9', 'Creada desde la reserva RES-000042 (04-10-2026). Faltan los datos de facturación.')
ON CONFLICT (rut) DO NOTHING;

UPDATE customers SET company_id = (SELECT id FROM companies WHERE rut = '76486342-9'), company_role = 'encargado', updated_at = NOW()
WHERE id = '1e0c20fd-19c4-4b45-8f13-c60a38323e01' AND company_id IS NULL;

UPDATE bookings SET company_id = (SELECT id FROM companies WHERE rut = '76486342-9')
WHERE id = 'ed059e8e-d9be-43fb-8fab-36c2001245c5' AND company_id IS NULL;

-- Instituto Hebreo S.A · 96689620-5 · reserva RES-000016 · CL-000449
INSERT INTO companies (razon_social, rut, notes)
VALUES ('Instituto Hebreo S.A', '96689620-5', 'Creada desde la reserva RES-000016 (04-10-2026). Faltan los datos de facturación.')
ON CONFLICT (rut) DO NOTHING;

UPDATE customers SET company_id = (SELECT id FROM companies WHERE rut = '96689620-5'), company_role = 'encargado', updated_at = NOW()
WHERE id = '3a84bea7-85ae-4298-9d45-73e00bd99ceb' AND company_id IS NULL;

UPDATE bookings SET company_id = (SELECT id FROM companies WHERE rut = '96689620-5')
WHERE id = 'bce364f2-6fd5-4d69-8b51-b72113fc74b3' AND company_id IS NULL;

-- Comprobación: debería listar las 6, cada una con 1 persona y 1 reserva.
SELECT c.code, c.razon_social, c.rut,
       (SELECT COUNT(*) FROM customers u WHERE u.company_id = c.id) AS personas,
       (SELECT COUNT(*) FROM bookings b WHERE b.company_id = c.id) AS reservas
FROM companies c ORDER BY c.code;
