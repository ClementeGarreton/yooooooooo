-- Migration: Activar Row Level Security en todas las tablas públicas
-- Date: 2026-08-17
-- Description: Cierra el agujero que reportó el advisor de Supabase por email el 09-08-2026
--              ("Table publicly accessible ... because Row-Level Security is not enabled").
--
-- QUÉ ESTABA PASANDO
-- ------------------
-- 7 de las 10 tablas del schema public no tenían RLS. Sin RLS, el rol `anon` —cuya API key
-- viaja en el bundle del navegador, o sea es pública por diseño— podía leer y escribir todo.
-- Verificado el 2026-08-17 leyendo con la anon key contra /rest/v1:
--
--   bookings          101 filas  ← nombre, email, teléfono, dirección origen Y destino,
--                                  RUT de empresa, flow_token / flow_order (pasarela de pago),
--                                  precios, pdf_url, photo_urls
--   quote_prospects   715 filas  ← mismo set de datos personales de cada lead
--   catalog_items     138 filas
--   pricing_config     37 filas  ← la lista de precios completa, editable
--   blocked_slots       1 fila
--   fleet_config        1 fila
--   schedule_config     1 fila
--
-- Las otras 3 (admin_users, admin_activity_log, email_log) ya estaban protegidas: existen
-- 3 / 91 / 5 filas y `anon` ve 0. Se incluyen igual más abajo porque ENABLE es idempotente.
--
-- El efecto colateral que no se ve a simple vista: el bucket de Storage `bookings` es público,
-- y su única protección real es que los nombres de archivo llevan UUID + timestamp (no se
-- adivinan, y `anon` no puede listar el bucket). Pero `bookings.pdf_url` y `photo_urls`
-- contienen esas URLs exactas — leyendo la tabla se obtenía la lista completa de PDFs y fotos.
-- Cerrar la tabla cierra también esa puerta.
--
-- POR QUÉ NO HACEN FALTA POLICIES
-- -------------------------------
-- La app NUNCA usa el cliente anon contra la base. Los 41 archivos que importan de
-- `@/lib/supabase` importan `supabaseAdmin` (service_role), y todo el acceso pasa por
-- API routes del servidor. El export `supabase` (anon) de src/lib/supabase.ts existe pero
-- no lo consume nadie: ningún componente 'use client' lo toca, no hay otro createClient()
-- en el repo, y el embed embed-yomeencargo.html ni menciona Supabase.
--
-- `service_role` tiene el atributo BYPASSRLS, así que ignora RLS por completo. Por eso
-- RLS activo + CERO policies = todo sigue funcionando igual y nadie de afuera entra.
-- Es la configuración correcta acá, no un atajo: agregar policies permisivas para "no
-- romper nada" reabriría exactamente el agujero que estamos cerrando.
--
-- OJO: usar ENABLE, nunca FORCE. `FORCE ROW LEVEL SECURITY` aplica las policies también
-- al dueño de la tabla y rompería el acceso desde el panel de Supabase.

-- ---------------------------------------------------------------------------
-- 1. Las 7 tablas expuestas
-- ---------------------------------------------------------------------------
ALTER TABLE public.bookings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_prospects  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_config   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_slots    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_config     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_config  ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. Las 3 que ya estaban bien (idempotente, por si acaso y para dejarlo explícito)
-- ---------------------------------------------------------------------------
ALTER TABLE public.admin_users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_log          ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. Cinturón y tiradores: sacarle los GRANT a anon
-- ---------------------------------------------------------------------------
-- RLS solo ya alcanza. Esto es una segunda capa por si alguna vez alguien agrega una
-- policy permisiva sin pensarlo: sin GRANT, la policy no le sirve de nada a anon.
-- Se deja `authenticated` intacto por si en el futuro se usa Supabase Auth (hoy no:
-- el login del admin es propio, contra la tabla admin_users vía src/lib/adminAuth.ts).
REVOKE ALL ON public.bookings         FROM anon;
REVOKE ALL ON public.quote_prospects  FROM anon;
REVOKE ALL ON public.catalog_items    FROM anon;
REVOKE ALL ON public.pricing_config   FROM anon;
REVOKE ALL ON public.blocked_slots    FROM anon;
REVOKE ALL ON public.fleet_config     FROM anon;
REVOKE ALL ON public.schedule_config  FROM anon;
REVOKE ALL ON public.admin_users        FROM anon;
REVOKE ALL ON public.admin_activity_log FROM anon;
REVOKE ALL ON public.email_log          FROM anon;

-- Que las tablas nuevas nazcan cerradas en vez de tener que acordarse cada vez.
-- (Aplica a lo que cree el rol postgres de acá en adelante; no toca lo ya existente.)
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;

-- ---------------------------------------------------------------------------
-- 4. Verificación — correr después y confirmar que las 10 dicen rls_activo = true
-- ---------------------------------------------------------------------------
-- SELECT tablename,
--        rowsecurity AS rls_activo,
--        (SELECT count(*) FROM pg_policies p
--          WHERE p.schemaname = 'public' AND p.tablename = t.tablename) AS policies
--   FROM pg_tables t
--  WHERE schemaname = 'public'
--  ORDER BY rowsecurity, tablename;
--
-- Esperado: las 10 filas con rls_activo = true. `policies` en 0 está bien y es lo buscado.
