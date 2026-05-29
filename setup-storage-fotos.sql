-- ═══════════════════════════════════════════════════════════════
--  LADY FRESA POS · Configuración de Storage para fotos de producto
--  Ejecutar UNA SOLA VEZ en Supabase → SQL Editor → New query → Run
-- ═══════════════════════════════════════════════════════════════

-- 1) Crear el bucket público "productos"
insert into storage.buckets (id, name, public)
values ('productos', 'productos', true)
on conflict (id) do update set public = true;

-- 2) Políticas de acceso sobre los archivos del bucket
--    (la app usa la "publishable key" = rol anon)

-- Lectura pública: cualquiera puede ver las fotos (necesario para que
-- todos los dispositivos las carguen por URL).
drop policy if exists "productos_lectura_publica" on storage.objects;
create policy "productos_lectura_publica"
  on storage.objects for select
  using ( bucket_id = 'productos' );

-- Subir fotos nuevas
drop policy if exists "productos_insert" on storage.objects;
create policy "productos_insert"
  on storage.objects for insert
  with check ( bucket_id = 'productos' );

-- Reemplazar / actualizar fotos (upsert)
drop policy if exists "productos_update" on storage.objects;
create policy "productos_update"
  on storage.objects for update
  using ( bucket_id = 'productos' )
  with check ( bucket_id = 'productos' );

-- (Opcional) Borrar fotos viejas
drop policy if exists "productos_delete" on storage.objects;
create policy "productos_delete"
  on storage.objects for delete
  using ( bucket_id = 'productos' );

-- ── Verificación ──────────────────────────────────────────────
-- Después de correr lo de arriba, deberías ver el bucket "productos"
-- en Supabase → Storage. La primera vez que subas una foto desde el
-- editor de productos, aparecerá un archivo prod-<id>-<timestamp>.png/jpg
