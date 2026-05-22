-- =============================================================
-- LADY FRESA POS - Schema Supabase v1
-- Pega TODO este archivo en Supabase > SQL Editor > Run
-- =============================================================

-- ----------------------------------------
-- 1) TABLAS
-- ----------------------------------------

-- Sucursales
create table if not exists public.branches (
  id text primary key,
  name text not null,
  emoji text default '🏪',
  class text default 'c1',
  addr text,
  tel text,
  hours text,
  principal boolean default false,
  status text default 'open',
  today numeric default 0,
  ordenes_hoy integer default 0,
  ticket numeric default 0,
  vs_ayer integer default 0,
  semana numeric default 0,
  club_activos integer default 0,
  top jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Categorias
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  emoji text default '🍓',
  position integer default 0,
  created_at timestamptz default now()
);

-- Productos
create table if not exists public.products (
  id integer primary key,
  name text not null,
  cat text references public.categories(name) on update cascade,
  price numeric not null default 0,
  cost numeric default 0,
  "desc" text,
  img text,
  mods jsonb default '[]'::jsonb,
  active boolean default true,
  position integer default 0,
  branch_id text references public.branches(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Modificadores
create table if not exists public.modifiers (
  name text primary key,
  required boolean default false,
  max_select integer default 1,
  label text default '',
  options jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Descuentos
create table if not exists public.discounts (
  id integer primary key,
  name text not null,
  description text default '',
  type text default 'percent',
  value numeric default 0,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Clientes Lady Club
create table if not exists public.customers (
  id integer primary key,
  name text not null,
  phone text,
  email text,
  pts integer default 0,
  next integer default 100,
  tier text default 'Bronce',
  spend numeric default 0,
  orders integer default 0,
  last text default '',
  vip boolean default false,
  bday text,
  since text default '2026',
  note text default '',
  favs jsonb default '[]'::jsonb,
  branch_id text references public.branches(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Usuarios y roles
create table if not exists public.app_users (
  pin text primary key,
  nombre text not null,
  alias text,
  rol text not null default 'cajero',
  emoji text default '🍓',
  color text default '#E67A8A',
  active boolean default true,
  branch_id text references public.branches(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Ordenes / ventas
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  n text not null,
  time text default to_char(now(), 'HH24:MI'),
  items jsonb not null default '[]'::jsonb,
  client text default '',
  customer_id integer references public.customers(id),
  svc text default 'mostrador',
  pay text default 'efectivo',
  subtotal numeric default 0,
  discount numeric default 0,
  iva numeric default 0,
  fee numeric default 0,
  total numeric not null default 0,
  status text default 'completada',
  refund jsonb,
  cashier_pin text references public.app_users(pin),
  branch_id text references public.branches(id),
  created_at timestamptz default now()
);

-- Ordenes aparcadas
create table if not exists public.parked_orders (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  items jsonb not null default '[]'::jsonb,
  client text default '',
  svc text default 'mostrador',
  cashier_pin text,
  branch_id text references public.branches(id),
  created_at timestamptz default now()
);

-- Configuracion / Ajustes
create table if not exists public.app_settings (
  id integer primary key default 1,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- ----------------------------------------
-- 2) INDICES
-- ----------------------------------------
create index if not exists idx_products_cat on public.products(cat);
create index if not exists idx_orders_branch on public.orders(branch_id);
create index if not exists idx_orders_created on public.orders(created_at desc);
create index if not exists idx_customers_phone on public.customers(phone);

-- ----------------------------------------
-- 3) RLS (Row Level Security)
-- v1: politicas permisivas (cualquier anon puede leer/escribir)
-- Cambiar a estrictas antes de produccion real.
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

do $$
declare t text;
begin
  for t in select unnest(array['branches','categories','products','modifiers','discounts','customers','app_users','orders','parked_orders','app_settings']) loop
    execute format('drop policy if exists "open_all_%I" on public.%I', t, t);
    execute format('create policy "open_all_%I" on public.%I for all using (true) with check (true)', t, t);
  end loop;
end$$;

-- ----------------------------------------
-- 4) REALTIME
-- ----------------------------------------
do $$
begin
  begin alter publication supabase_realtime add table public.orders; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.products; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.customers; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.parked_orders; exception when duplicate_object then null; end;
end$$;

-- REPLICA IDENTITY FULL hace que los eventos UPDATE incluyan todos los campos del row,
-- no solo el id. Necesario para que cambios de status/refund se propaguen correctamente.
alter table public.orders replica identity full;
alter table public.products replica identity full;
alter table public.customers replica identity full;
alter table public.parked_orders replica identity full;

-- ----------------------------------------
-- 5) SEED INICIAL
-- ----------------------------------------

-- Sucursales (sucursales reales de Lady Fresa)
insert into public.branches (id, name, emoji, class, addr, tel, hours, principal, status)
values
  ('balbuena', 'Balbuena', '🌸', 'c1', 'Balbuena · CDMX', '', '11:00 - 22:00', true, 'open'),
  ('delvalle', 'Del Valle', '🍓', 'c2', 'Del Valle · CDMX', '', '11:00 - 22:00', false, 'open')
on conflict (id) do nothing;

-- Categorias
insert into public.categories (name, emoji, position) values
  ('Frutas', '🍓', 1),
  ('Especiales LFM', '🍰', 2),
  ('Bebidas', '🥤', 3)
on conflict (name) do nothing;

-- Usuarios demo
insert into public.app_users (pin, nombre, alias, rol, emoji, color) values
  ('0000', 'Lozo', 'Lozo', 'admin', '👑', '#D93956'),
  ('1111', 'Mariana', 'Mariana', 'gerente', '👩‍💼', '#A85B7C'),
  ('2222', 'Ana', 'Ana', 'cajero', '🍓', '#E67A8A'),
  ('3333', 'Luis', 'Luis', 'cajero', '🧑‍🍳', '#E67A8A')
on conflict (pin) do nothing;

-- Productos demo
insert into public.products (id, name, cat, price, "desc", img, mods, active) values
  (1, 'Fresas', 'Frutas', 99, 'Elige base y toppings.', 'img/products/fresas.png', '["Tamaño","Bases","Toppings Incluidos","Extra Premium"]'::jsonb, true),
  (2, 'Platanos', 'Frutas', 99, 'Elige base y toppings.', 'img/products/platanos.png', '["Tamaño","Bases","Toppings Incluidos","Extra Premium"]'::jsonb, true),
  (3, 'Combinado', 'Frutas', 109, 'Fresas + platano.', 'img/products/combinado.png', '["Tamaño","Bases","Toppings Incluidos","Extra Premium"]'::jsonb, true),
  (4, 'La Caramelita', 'Especiales LFM', 149, 'Platano, crema, caramelo.', 'img/products/caramelita.png', '["Extra Premium"]'::jsonb, true),
  (5, 'La Cookie Lover', 'Especiales LFM', 159, 'Fresas, crema, Oreo.', 'img/products/cookie-lover.png', '["Extra Premium"]'::jsonb, true),
  (6, 'Lady Lotus', 'Especiales LFM', 159, 'Fresas, caramelo, Lotus.', 'img/products/lady-lotus.png', '["Extra Premium"]'::jsonb, true),
  (7, 'La Mas Mexa', 'Especiales LFM', 149, 'Fresas, platano, mazapan.', 'img/products/mas-mexa.png', '["Extra Premium"]'::jsonb, true),
  (8, 'La Mil Leches', 'Especiales LFM', 169, 'El clasico elevado.', null, '["Extra Premium"]'::jsonb, true),
  (9, 'La Pistachona', 'Especiales LFM', 189, 'Fresas, pistache, Dubai.', 'img/products/pistachona.png', '["Extra Premium"]'::jsonb, true),
  (10, 'La Presumida', 'Especiales LFM', 159, 'Nutella, ferrero, avellana.', 'img/products/presumida.png', '["Extra Premium"]'::jsonb, true),
  (11, 'Agua Mineral', 'Bebidas', 50, '355ml.', null, '[]'::jsonb, true),
  (12, 'Agua Natural', 'Bebidas', 50, 'Alcalina 500ml.', null, '[]'::jsonb, true),
  (13, 'Cafe de Olla', 'Bebidas', 45, 'Canela y piloncillo - 12oz.', 'img/products/cafe.png', '[]'::jsonb, true)
on conflict (id) do nothing;

-- Modificadores
insert into public.modifiers (name, required, max_select, label, options) values
  ('Tamaño', true, 1, '', '[{"name":"Chico","extra":0},{"name":"Mediano","extra":36},{"name":"Grande","extra":50}]'::jsonb),
  ('Bases', true, 1, '', '[{"name":"Crema","extra":0},{"name":"Chococrema","extra":15},{"name":"Caramel cream","extra":20},{"name":"Chocolate","extra":25},{"name":"Caramelo","extra":30},{"name":"Chocolate Blanco","extra":25}]'::jsonb),
  ('Toppings Incluidos', false, 2, '2 gratis', '[{"name":"Almendra","extra":0},{"name":"Oreo","extra":0},{"name":"Coco","extra":0},{"name":"Choco Chips","extra":0},{"name":"Lechera","extra":0},{"name":"Amaranto","extra":0},{"name":"Mazapán","extra":0},{"name":"M&Ms","extra":0}]'::jsonb),
  ('Extra Premium', false, 5, '+$25 c/u', '[{"name":"Ferrero","extra":25},{"name":"Pistache","extra":25},{"name":"KitKat","extra":25},{"name":"Lotus","extra":25},{"name":"Dubai","extra":25},{"name":"Nutella","extra":25}]'::jsonb)
on conflict (name) do nothing;

-- Descuentos demo
insert into public.discounts (id, name, description, type, value, active) values
  (1, '-10% estudiantes', 'Codigo ESTUDIANTE - lun-vie 14-17h', 'percent', 10, true),
  (2, '2x$250 Fresas Chico', 'Combo - todos los dias', 'combo', 250, true),
  (3, '-$30 primera compra', 'App - un uso por cliente', 'fixed', 30, false)
on conflict (id) do nothing;

-- LISTO. Deberias ver "Success. No rows returned"
-- Verifica en Table Editor que aparezcan las 10 tablas con datos.
