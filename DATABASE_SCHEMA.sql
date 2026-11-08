-- =====================================================================
-- DineFlow – relational schema for Supabase PostgreSQL
-- Optional: only needed for a hosted / production deployment. The one-click local demo does not use it.
-- Run in the Supabase SQL editor (or: supabase db push). Seed data is in SEED_DATA.sql.
--
-- IMPORTANT – what is wired up today:
--   • The demo app runs on its own local server and a JSON database file (data/demo-db.json).
--     `demo_state` (section 1) is only the optional mirror for static hosting.
--   • Sections 2–6 are the production-shaped relational design (13 tables, keys, indexes,
--     constraints, RLS, seed). The React app does not read these tables yet; the
--     migration path is described in PROJECT_ARCHITECTURE.md.
--
-- Time: every timestamp is timestamptz (stored in UTC). The UI formats in the browser's
-- timezone (Asia/Kolkata for the demo restaurant).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Demo state mirror (used by the app in Supabase-sync mode)
--    DEMO ONLY: anon can read/write this one row. Never put real customer data here.
-- ---------------------------------------------------------------------
create table if not exists demo_state (
  id          text primary key,
  state       jsonb not null,
  updated_at  timestamptz not null default now()
);
alter table demo_state enable row level security;
drop policy if exists demo_state_read  on demo_state;
drop policy if exists demo_state_write on demo_state;
create policy demo_state_read  on demo_state for select using (true);
create policy demo_state_write on demo_state for all using (id = 'main') with check (id = 'main');
alter publication supabase_realtime add table demo_state;

-- ---------------------------------------------------------------------
-- 2. Relational schema
-- ---------------------------------------------------------------------

-- Staff profiles (role comes from Supabase Auth; set app_metadata.role = staff|kitchen|admin)
create table if not exists staff_profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role        text not null check (role in ('staff','kitchen','admin')),
  created_at  timestamptz not null default now()
);

create table if not exists restaurant_settings (
  id                  int primary key default 1 check (id = 1),     -- single-row table
  restaurant_name     text not null default 'Menues',
  open_time           time not null default '11:00',
  close_time          time not null default '23:00',
  queue_grace_minutes int  not null default 5  check (queue_grace_minutes between 1 and 30),
  cleaning_minutes    int  not null default 3  check (cleaning_minutes between 0 and 30),
  max_skips           int  not null default 2  check (max_skips >= 0),
  dining_minutes_small  int not null default 45,
  dining_minutes_medium int not null default 60,
  dining_minutes_large  int not null default 75,
  ready_offset_minutes  int not null default 0  check (ready_offset_minutes >= 0),
  max_early_minutes     int not null default 10 check (max_early_minutes >= 0),
  gst_percent           numeric(4,2) not null default 5,
  kiosk_pin_hash        text,                                      -- never store the kiosk PIN in clear text
  public_base_url       text check (public_base_url is null or public_base_url ~ '^https?://'),
  session_hours         int  not null default 6 check (session_hours between 1 and 24),
  timezone              text not null default 'Asia/Kolkata',
  updated_at            timestamptz not null default now()
);

create table if not exists customers (
  id          uuid primary key default gen_random_uuid(),
  phone       text not null unique check (phone ~ '^[6-9][0-9]{9}$'),
  name        text check (char_length(name) <= 40),
  created_at  timestamptz not null default now()
);

create table if not exists tables (
  id          text primary key check (id ~ '^T[0-9]{2,3}$'),
  capacity    int  not null check (capacity between 1 and 20),
  zone        text not null default 'Indoor' check (zone in ('Indoor','Outdoor','Window')),
  status      text not null default 'available' check (status in ('available','reserved','occupied','cleaning','blocked')),
  clean_done_at timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists kitchen_stations (
  id          text primary key,
  name        text not null,
  chefs       int  not null default 1 check (chefs between 1 and 8)
);

create table if not exists menu_categories (
  id          serial primary key,
  name        text not null unique,
  sort_order  int  not null default 0
);

create table if not exists menu_items (
  id            serial primary key,
  category_id   int  not null references menu_categories(id),
  station_id    text not null references kitchen_stations(id),
  name          text not null check (char_length(name) between 1 and 60),
  description   text check (char_length(description) <= 160),
  is_veg        boolean not null default true,
  price         numeric(8,2) not null check (price >= 0),
  prep_minutes  int  not null check (prep_minutes >= 1),
  complexity    int  not null default 2 check (complexity between 1 and 5),
  image_url     text,
  options       jsonb not null default '[]',
  available     boolean not null default true,
  stock         int check (stock is null or stock >= 0),
  created_at    timestamptz not null default now()
);

create table if not exists queue_entries (
  token            text primary key,                     -- Q024
  customer_id      uuid not null references customers(id),
  party_size       int  not null check (party_size >= 1),
  seating_pref     text not null default 'Any' check (seating_pref in ('Any','Indoor','Outdoor','Window')),
  status           text not null default 'waiting' check (status in ('waiting','called','seated','cancelled','abandoned','no_show')),
  source           text not null default 'self' check (source in ('self','staff','kiosk')),
  -- Personal queue link: /queue/session/<session_token>. 24 random bytes (base64url); NO phone number in it.
  -- Store only a hash (sha-256) of the token in production; the plain token exists only in the QR code.
  session_token_hash text unique,
  session_expires_at timestamptz,
  session_opened_at  timestamptz,           -- set when the customer's phone first opens the link (kiosk shows 'scanned')
  priority         int  not null default 0,
  skip_count       int  not null default 0,
  table_id         text references tables(id),
  manual_seat_at   timestamptz,
  predicted_wait_minutes int,
  joined_at        timestamptz not null default now(),
  called_at        timestamptz,
  seated_at        timestamptz,
  ended_at         timestamptz
);
create sequence if not exists queue_token_seq start 1;
-- A customer can only have one active entry at a time.
create unique index if not exists one_active_entry_per_customer on queue_entries(customer_id) where status in ('waiting','called');
create index if not exists queue_status_idx on queue_entries(status, priority desc, joined_at);

create table if not exists seating_sessions (
  id               uuid primary key default gen_random_uuid(),
  table_id         text not null references tables(id),
  queue_token      text references queue_entries(token),
  customer_id      uuid references customers(id),
  party_size       int  not null check (party_size >= 1),
  seated_at        timestamptz not null default now(),
  expected_depart_at timestamptz,
  ended_at         timestamptz,
  status           text not null default 'active' check (status in ('active','ended'))
);
-- One active session per table.
create unique index if not exists one_active_session_per_table on seating_sessions(table_id) where status = 'active';

create table if not exists orders (
  id               uuid primary key default gen_random_uuid(),
  order_no         bigserial unique,
  type             text not null check (type in ('preorder','qr')),
  client_request_id text unique,                                -- double-submit protection
  customer_id      uuid references customers(id),
  queue_token      text references queue_entries(token),        -- pre-orders
  session_id       uuid references seating_sessions(id),        -- QR orders
  table_id         text references tables(id),
  status           text not null default 'pending_payment' check (status in ('pending_payment','confirmed','scheduled','received','preparing','ready','served','cancelled')),
  payment_status   text not null default 'pending' check (payment_status in ('pending','paid','failed','refund_initiated')),
  subtotal         numeric(10,2) not null check (subtotal >= 0),
  tax              numeric(10,2) not null check (tax >= 0),
  total            numeric(10,2) not null check (total >= 0),
  refunded_amount  numeric(10,2) not null default 0,
  expected_seat_at timestamptz,
  created_at       timestamptz not null default now(),
  paid_at          timestamptz,
  first_served_at  timestamptz,
  ready_at         timestamptz,
  constraint preorder_has_token check (type <> 'preorder' or queue_token is not null),
  constraint qr_has_session check (type <> 'qr' or (session_id is not null and table_id is not null))
);
create index if not exists orders_status_idx on orders(status, created_at);
create index if not exists orders_token_idx on orders(queue_token);

create table if not exists order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id) on delete cascade,
  menu_item_id  int  not null references menu_items(id),
  name          text not null,
  qty           int  not null check (qty between 1 and 20),
  unit_price    numeric(8,2) not null check (unit_price >= 0),
  options       jsonb not null default '[]',
  instructions  text check (char_length(instructions) <= 140),
  status        text not null default 'pending' check (status in ('pending','queued','scheduled','received','preparing','ready','served','cancelled')),
  actual_prep_minutes numeric(5,1)
);
create index if not exists order_items_order_idx on order_items(order_id);

create table if not exists payments (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references orders(id),
  amount              numeric(10,2) not null check (amount >= 0),
  currency            text not null default 'INR',
  mode                text not null check (mode = 'demo'),   -- simulated payment; no provider, no card data
  status              text not null check (status in ('paid','failed','refund_initiated')),
  idempotency_key     text unique,                               -- duplicate callbacks are ignored
  provider_payment_id text unique,
  created_at          timestamptz not null default now()
);
-- At most one successful payment per order.
create unique index if not exists one_paid_payment_per_order on payments(order_id) where status = 'paid';

create table if not exists kitchen_tasks (
  id              uuid primary key default gen_random_uuid(),
  order_item_id   uuid not null unique references order_items(id) on delete cascade,
  station_id      text not null references kitchen_stations(id),
  duration_minutes int not null check (duration_minutes >= 1),
  status          text not null default 'scheduled' check (status in ('scheduled','received','preparing','ready','served','cancelled')),
  priority        text not null default 'normal' check (priority in ('normal','high')),
  scheduled_start timestamptz,
  est_ready       timestamptz,
  manual_override boolean not null default false,
  started_at      timestamptz,
  ready_at        timestamptz,
  served_at       timestamptz
);
create index if not exists kitchen_tasks_idx on kitchen_tasks(station_id, status, scheduled_start);

create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id),
  queue_token text references queue_entries(token),
  order_id    uuid references orders(id),
  kind        text not null,
  body        text not null,
  channel     text not null default 'in_app' check (channel = 'in_app'),   -- DineFlow sends no SMS
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. Server-side helpers
-- ---------------------------------------------------------------------
create or replace function app_role() returns text language sql stable as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'anon')
$$;

-- Atomic token generation (call from an RPC / Edge Function when a customer joins).
create or replace function next_queue_token() returns text language sql as $$
  select 'Q' || lpad(nextval('queue_token_seq')::text, 3, '0')
$$;

-- Only 'paid' once, even if the payment webhook fires twice (the unique indexes do the real work).
create or replace function confirm_payment(p_order uuid, p_key text, p_provider text, p_mode text)
returns payments language plpgsql security definer set search_path = public as $$
declare pay payments; ord orders;
begin
  select * into pay from payments where idempotency_key = p_key;
  if found then return pay; end if;                              -- duplicate callback
  select * into ord from orders where id = p_order for update;
  if ord.payment_status = 'paid' then
    select * into pay from payments where order_id = p_order and status = 'paid'; return pay;
  end if;
  insert into payments(order_id, amount, mode, status, idempotency_key, provider_payment_id)
    values (p_order, ord.total, p_mode, 'paid', p_key, p_provider) returning * into pay;
  update orders set payment_status = 'paid', status = 'confirmed', paid_at = now() where id = p_order;
  return pay;
end $$;
revoke all on function confirm_payment from public, anon, authenticated;   -- only Edge Functions (service role) call it

-- ---------------------------------------------------------------------
-- 4. Row-level security
--    anon (customers): read the public menu/tables/settings; everything else goes through
--    Edge Functions that hold the service-role key. Staff/kitchen/admin use Supabase Auth.
-- ---------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['staff_profiles','restaurant_settings','customers','tables','kitchen_stations','menu_categories','menu_items','queue_entries','seating_sessions','orders','order_items','payments','kitchen_tasks','notifications']
  loop execute format('alter table %I enable row level security', t); end loop;
end $$;

-- Public read
create policy public_read_menu_items  on menu_items       for select using (true);
create policy public_read_categories  on menu_categories  for select using (true);
create policy public_read_stations    on kitchen_stations for select using (true);
create policy public_read_tables      on tables           for select using (true);
create policy public_read_settings    on restaurant_settings for select using (true);

-- Staff / kitchen / admin
create policy staff_all_queue    on queue_entries    for all using (app_role() in ('staff','admin')) with check (app_role() in ('staff','admin'));
create policy staff_all_sessions on seating_sessions for all using (app_role() in ('staff','admin')) with check (app_role() in ('staff','admin'));
create policy staff_all_tables   on tables           for all using (app_role() in ('staff','admin')) with check (app_role() in ('staff','admin'));
create policy staff_read_cust    on customers        for select using (app_role() in ('staff','admin'));
create policy staff_read_orders  on orders           for select using (app_role() in ('staff','kitchen','admin'));
create policy staff_read_items   on order_items      for select using (app_role() in ('staff','kitchen','admin'));
create policy staff_read_pay     on payments         for select using (app_role() in ('staff','admin'));
create policy staff_read_notif   on notifications    for select using (app_role() in ('staff','admin'));
create policy kitchen_tasks_rw   on kitchen_tasks    for all using (app_role() in ('staff','kitchen','admin')) with check (app_role() in ('staff','kitchen','admin'));
create policy kitchen_orders_upd on orders           for update using (app_role() in ('kitchen','staff','admin'));

-- Admin only
create policy admin_menu_write   on menu_items       for all using (app_role() = 'admin') with check (app_role() = 'admin');
create policy admin_cat_write    on menu_categories  for all using (app_role() = 'admin') with check (app_role() = 'admin');
create policy admin_station_wr   on kitchen_stations for all using (app_role() = 'admin') with check (app_role() = 'admin');
create policy admin_settings_wr  on restaurant_settings for update using (app_role() = 'admin');
create policy admin_profiles     on staff_profiles   for all using (app_role() = 'admin') with check (app_role() = 'admin');

-- Customers have NO direct table access beyond the public reads above.
-- Customer reads of their own queue entry / order happen through an Edge Function that
-- checks the token (queue token or order id) and returns only that record, with the
-- phone number masked.

-- Realtime for the live screens
alter publication supabase_realtime add table queue_entries, tables, orders, order_items, kitchen_tasks, menu_items;

-- Seed data: see SEED_DATA.sql
-- Demo staff accounts are created in Supabase Auth (Dashboard → Authentication → Users),
-- then given a role:  update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}' where email = '...';
