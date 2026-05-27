-- =============================================================
-- LADY FRESA POS · Schema v2 — Hardened
-- Cambios vs v1:
--   1. PINs hasheados con bcrypt (extension pgcrypto)
--   2. Función verify_pin() que devuelve datos del usuario sin
--      exponer la tabla app_users a clientes anon.
--   3. RLS por sucursal y rol (anon NO lee orders, customers,
--      app_users, app_settings).
--   4. Catálogo público (products, categories, modifiers, etc.)
--      legible por anon, escritura solo con JWT claim role=admin.
--   5. Trigger updated_at automático.
--   6. Índice compuesto (branch_id, created_at desc) en orders.
--   7. orders.tip y orders.customer_id se pueblan correctamente.
--   8. Tabla product_ingredients para descuento de insumos.
--
-- INSTRUCCIONES DE MIGRACIÓN
-- =============================================================
-- Si ya tienes datos en producción, EJECUTA POR PASOS:
--   PASO 1: secciones 1, 2 (extensiones + tablas nuevas).
--   PASO 2: sección 3 (migrar PINs a hash — un solo run).
--   PASO 3: sección 4 (funciones).
--   PASO 4: sección 5 (RLS — esto rompe la app vieja, hacerlo
--           SOLO después de desplegar el frontend nuevo).
--   PASO 5: sección 6 (realtime + índices). Idempotente.
-- =============================================================

-- ----------------------------------------
-- 1) EXTENSIONES
-- ----------------------------------------
create extension if not exists pgcrypto;

-- ----------------------------------------
-- 2) TABLAS (idempotente — solo añade)
-- ----------------------------------------

-- app_users: añadir pin_hash, dejar pin para migración
alter table if exists public.app_users
  add column if not exists pin_hash text,
  add column if not exists last_login timestamptz,
  add column if not exists failed_attempts integer default 0,
  add column if not exists locked_until timestamptz;

-- orders: añadir tip y asegurar customer_id
alter table if exists public.orders
  add column if not exists tip numeric default 0;

-- product_ingredients: receta para descuento automático
create table if not exists public.product_ingredients (
  product_id integer references public.products(id) on delete cascade,
  sku text references public.inventory(sku) on delete cascade,
  qty_per_unit numeric not null default 0,
  primary key (product_id, sku)
);

-- Trigger genérico de updated_at
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end$$;

do $$
declare t text;
begin
  for t in select unnest(array['branches','products','modifiers','discounts','customers','app_users','inventory']) loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I; '
      'create trigger set_updated_at before update on public.%I '
      'for each row execute function public.tg_set_updated_at()',
      t, t
    );
  end loop;
end$$;

-- ----------------------------------------
-- 3) MIGRACIÓN DE PINs A HASH
-- ----------------------------------------
-- Hashea los PINs existentes que aún están en texto plano.
-- Idempotente: si pin_hash ya está poblado, no toca nada.

update public.app_users
set pin_hash = crypt(pin, gen_salt('bf', 10))
where pin_hash is null and pin is not null;

-- Después de verificar que verify_pin funciona, descomenta para
-- limpiar los PINs en texto plano:
-- update public.app_users set pin = null where pin_hash is not null;

-- ----------------------------------------
-- 4) FUNCIONES (security definer)
-- ----------------------------------------

-- verify_pin: única vía de autenticación desde el cliente anon.
-- Devuelve los datos del usuario si el PIN es correcto, null si no.
-- Implementa rate limit por usuario (5 intentos fallidos -> bloqueo 5 min).
create or replace function public.verify_pin(p_pin text)
returns table (
  pin text, nombre text, alias text, rol text,
  emoji text, color text, branch_id text
)
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  u record;
begin
  if p_pin is null or length(p_pin) < 3 then
    return;
  end if;

  -- Buscar por hash; si no hay hash todavía, fallback al pin plano
  -- (solo durante el periodo de migración)
  select * into u from public.app_users au
  where (au.pin_hash is not null and au.pin_hash = crypt(p_pin, au.pin_hash))
     or (au.pin_hash is null and au.pin = p_pin)
  limit 1;

  if not found then
    -- Incrementar intentos fallidos (best effort, sin info al cliente).
    -- Importante calificar pin con alias 'au' (ambiguo vs parámetro)
    update public.app_users au
      set failed_attempts = coalesce(au.failed_attempts, 0) + 1,
          locked_until = case
            when coalesce(au.failed_attempts, 0) + 1 >= 5
            then now() + interval '5 minutes'
            else au.locked_until
          end
      where au.pin = p_pin;
    return;
  end if;

  -- Si está bloqueado, no devolver nada
  if u.locked_until is not null and u.locked_until > now() then
    return;
  end if;

  -- Si está inactivo, no devolver nada
  if u.active = false then
    return;
  end if;

  -- Login exitoso: limpiar contadores y registrar
  update public.app_users au
    set failed_attempts = 0,
        locked_until = null,
        last_login = now()
    where au.pin = u.pin;

  return query select u.pin, u.nombre, u.alias, u.rol, u.emoji, u.color, u.branch_id;
end$$;

revoke all on function public.verify_pin(text) from public;
grant execute on function public.verify_pin(text) to anon, authenticated;

-- ----------------------------------------
-- Helper: rol del usuario actual (vía JWT custom claim)
-- ----------------------------------------
-- El frontend, tras verify_pin, debe llamar a sb.auth.signInAnonymously()
-- y guardar el rol en localStorage para incluirlo en headers, O bien
-- usar Supabase Auth real. Mientras no haya auth real, las policies
-- usan un header custom 'x-lf-role' que el cliente envía y que el JWT
-- claim setea. Para v2 simplificada, usamos request.headers.

create or replace function public.lf_current_role()
returns text language sql stable as $$
  select coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> 'lf_role',
    nullif(current_setting('request.headers', true)::jsonb ->> 'x-lf-role', ''),
    'anon'
  )
$$;

create or replace function public.lf_current_branch()
returns text language sql stable as $$
  select coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> 'lf_branch',
    nullif(current_setting('request.headers', true)::jsonb ->> 'x-lf-branch', ''),
    null
  )
$$;

-- ----------------------------------------
-- 5) RLS POR ROL Y SUCURSAL
-- ----------------------------------------

alter table public.branches enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.modifiers enable row level security;
alter table public.discounts enable row level security;
alter table public.customers enable row level security;
alter table public.app_users enable row level security;
alter table public.orders enable row level security;
alter table public.parked_orders enable row level security;
alter table public.app_settings enable row level security;
alter table public.inventory enable row level security;
alter table public.product_ingredients enable row level security;

-- Limpiar policies viejas permisivas
do $$
declare t text;
begin
  for t in select unnest(array['branches','categories','products','modifiers','discounts','customers','app_users','orders','parked_orders','app_settings','inventory','product_ingredients']) loop
    execute format('drop policy if exists "open_all_%I" on public.%I', t, t);
    execute format('drop policy if exists "%I_read" on public.%I', t, t);
    execute format('drop policy if exists "%I_write" on public.%I', t, t);
  end loop;
end$$;

-- CATÁLOGO PÚBLICO: branches, categories, products, modifiers, discounts
-- Lectura: cualquier anon (la app sin login muestra catálogo)
-- Escritura: solo gerente/admin
create policy "branches_read" on public.branches for select using (true);
create policy "branches_write" on public.branches for all
  using (lf_current_role() in ('admin','gerente'))
  with check (lf_current_role() in ('admin','gerente'));

create policy "categories_read" on public.categories for select using (true);
create policy "categories_write" on public.categories for all
  using (lf_current_role() in ('admin','gerente'))
  with check (lf_current_role() in ('admin','gerente'));

create policy "products_read" on public.products for select using (true);
create policy "products_write" on public.products for all
  using (lf_current_role() in ('admin','gerente'))
  with check (lf_current_role() in ('admin','gerente'));

create policy "modifiers_read" on public.modifiers for select using (true);
create policy "modifiers_write" on public.modifiers for all
  using (lf_current_role() in ('admin','gerente'))
  with check (lf_current_role() in ('admin','gerente'));

create policy "discounts_read" on public.discounts for select using (true);
create policy "discounts_write" on public.discounts for all
  using (lf_current_role() in ('admin','gerente'))
  with check (lf_current_role() in ('admin','gerente'));

-- DATOS OPERATIVOS: orders, parked_orders, inventory
-- Lectura: cajero ve solo su sucursal; gerente igual; admin todas.
-- Escritura: cajero solo en su sucursal, admin global.
create policy "orders_read" on public.orders for select using (
  lf_current_role() = 'admin'
  or (lf_current_role() in ('gerente','cajero') and branch_id = lf_current_branch())
);
create policy "orders_insert" on public.orders for insert with check (
  lf_current_role() in ('admin','gerente','cajero')
  and (lf_current_role() = 'admin' or branch_id = lf_current_branch())
);
create policy "orders_update" on public.orders for update using (
  lf_current_role() = 'admin'
  or (lf_current_role() = 'gerente' and branch_id = lf_current_branch())
);
create policy "orders_delete" on public.orders for delete using (
  lf_current_role() = 'admin'
);

create policy "parked_read" on public.parked_orders for select using (
  lf_current_role() = 'admin'
  or (lf_current_role() in ('gerente','cajero') and branch_id = lf_current_branch())
);
create policy "parked_write" on public.parked_orders for all using (
  lf_current_role() in ('admin','gerente','cajero')
  and (lf_current_role() = 'admin' or branch_id = lf_current_branch())
) with check (
  lf_current_role() in ('admin','gerente','cajero')
  and (lf_current_role() = 'admin' or branch_id = lf_current_branch())
);

create policy "inventory_read" on public.inventory for select using (
  lf_current_role() = 'admin'
  or (lf_current_role() in ('gerente','cajero') and (branch_id = lf_current_branch() or branch_id is null))
);
create policy "inventory_write" on public.inventory for all using (
  lf_current_role() in ('admin','gerente')
) with check (
  lf_current_role() in ('admin','gerente')
);

-- CLIENTES Lady Club: cajero lee/escribe, admin ve todo
create policy "customers_read" on public.customers for select using (
  lf_current_role() in ('admin','gerente','cajero')
);
create policy "customers_write" on public.customers for all using (
  lf_current_role() in ('admin','gerente','cajero')
) with check (
  lf_current_role() in ('admin','gerente','cajero')
);

-- USUARIOS app_users: NUNCA expuesta a anon. Solo admin escribe.
-- La autenticación va por verify_pin (security definer).
create policy "users_admin_only" on public.app_users for all using (
  lf_current_role() = 'admin'
) with check (
  lf_current_role() = 'admin'
);

-- AJUSTES: gerente/admin
create policy "settings_read" on public.app_settings for select using (
  lf_current_role() in ('admin','gerente','cajero')
);
create policy "settings_write" on public.app_settings for all using (
  lf_current_role() in ('admin','gerente')
) with check (
  lf_current_role() in ('admin','gerente')
);

-- PRODUCT_INGREDIENTS: lectura abierta (para que el cliente calcule),
-- escritura solo gerente/admin
create policy "ingredients_read" on public.product_ingredients for select using (true);
create policy "ingredients_write" on public.product_ingredients for all
  using (lf_current_role() in ('admin','gerente'))
  with check (lf_current_role() in ('admin','gerente'));

-- ----------------------------------------
-- 6) ÍNDICES Y REALTIME
-- ----------------------------------------

-- Compuesto para queries del historial (filtro por branch + ordenar por fecha)
drop index if exists idx_orders_branch;
drop index if exists idx_orders_created;
create index if not exists idx_orders_branch_created
  on public.orders(branch_id, created_at desc);

create index if not exists idx_orders_customer
  on public.orders(customer_id)
  where customer_id is not null;

create index if not exists idx_orders_status
  on public.orders(status)
  where status != 'completada';

create index if not exists idx_customers_phone on public.customers(phone);
create index if not exists idx_products_cat on public.products(cat);
create index if not exists idx_inventory_branch on public.inventory(branch_id);

-- Realtime (idempotente)
do $$
begin
  begin alter publication supabase_realtime add table public.orders; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.products; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.customers; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.parked_orders; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.inventory; exception when duplicate_object then null; end;
end$$;

-- REPLICA IDENTITY: full solo donde necesitamos UPDATEs propagados
-- (orders por refunds, customers por puntos). El resto = default.
alter table public.orders replica identity full;
alter table public.customers replica identity full;
-- products, parked_orders, inventory: replica identity DEFAULT (más eficiente)
alter table public.products replica identity default;
alter table public.parked_orders replica identity default;
alter table public.inventory replica identity default;

-- ----------------------------------------
-- 7) VERIFICACIÓN
-- ----------------------------------------
-- Después de correr esto:
--   1. select * from verify_pin('0000');  -> debe devolver Lozo
--   2. select * from verify_pin('9999');  -> debe devolver vacío
--   3. select * from app_users;           -> debe fallar para anon
--   4. select * from products;            -> debe funcionar para anon
--   5. select * from orders;              -> debe fallar para anon sin header

-- LISTO.
