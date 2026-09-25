-- OrderWise demo schema. Run once in the Supabase SQL editor (or psql).
-- DEMO: no RLS — the server is the only client and uses the service key.

create table if not exists retailers (
  id         bigint generated always as identity primary key,
  name       text not null,
  phone      text not null unique,
  area       text not null
);

create table if not exists products (
  id          bigint generated always as identity primary key,
  name        text not null,
  sku         text not null unique,
  unit_price  numeric(10,2) not null,   -- PKR
  stock_level integer not null default 0,
  expiry_flag boolean not null default false,  -- "expiring soon" badge (derived from expiry_date)
  expiry_date date,                            -- due/best-before date; null = not tracked
  active      boolean not null default true    -- soft-delete: false = pulled from the shelf
);

-- Additive columns for databases created before inventory management existed.
alter table products add column if not exists expiry_date date;
alter table products add column if not exists active boolean not null default true;

create table if not exists orders (
  id          bigint generated always as identity primary key,
  retailer_id bigint not null references retailers(id),
  status      text not null default 'pending' check (status in ('pending', 'fulfilled')),
  created_at  timestamptz not null default now()
);

create table if not exists order_items (
  id         bigint generated always as identity primary key,
  order_id   bigint not null references orders(id) on delete cascade,
  product_id bigint not null references products(id),
  quantity   integer not null check (quantity > 0)
);

create index if not exists idx_orders_created_at on orders (created_at desc);
create index if not exists idx_order_items_order on order_items (order_id);
create index if not exists idx_products_active on products (active);
