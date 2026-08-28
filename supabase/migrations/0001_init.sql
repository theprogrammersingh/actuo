-- Actuo — initial schema (PRD §8.7).
--
-- Reached ONLY by backend/ using the Supabase service-role key (PRD §8.2 data
-- boundary). RLS is enabled on every table with no policies attached: the
-- service role bypasses RLS, so the backend keeps working, while a leaked anon
-- or authenticated key can read nothing. Do not add permissive policies here
-- without also revisiting that boundary.
--
-- Conventions:
--   * UUID primary keys, defaulted with gen_random_uuid()
--   * timestamptz everywhere (never bare timestamp)
--   * snake_case columns; backend/src/supabase/mappers.ts maps them to the
--     camelCase domain types in @actuo/shared
--   * expenses are soft-deleted via deleted_at; every read filters it out

create extension if not exists "pgcrypto";
-- Powers the trigram indexes behind GET /api/expenses/search.
create extension if not exists "pg_trgm";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Mirrors Role in shared/src/domain.ts.
do $$ begin
  create type membership_role as enum ('owner', 'admin', 'member');
exception when duplicate_object then null; end $$;

-- Mirrors ExpenseStatus. The legal transitions between these values are
-- enforced in the API layer by canTransition() from @actuo/shared, not by a
-- database trigger — the backend is the single enforcer (PRD §6.4).
do $$ begin
  create type expense_status as enum (
    'draft', 'submitted', 'approved', 'rejected', 'reimbursed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type tool_call_actor as enum ('human', 'agent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type budget_period as enum ('monthly');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text        not null,
  password_hash text        not null,
  name          text        not null,
  created_at    timestamptz not null default now()
);

-- Email is the login identity: case-insensitive unique. The backend lowercases
-- on write, but the index is the actual guarantee.
create unique index if not exists users_email_lower_key on users (lower(email));

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------

create table if not exists organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text        not null,
  base_currency text        not null default 'INR',
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- memberships — the tenancy join, and the sole source of truth for RBAC.
-- ---------------------------------------------------------------------------

create table if not exists memberships (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references users (id) on delete cascade,
  org_id    uuid not null references organizations (id) on delete cascade,
  role      membership_role not null default 'member',
  joined_at timestamptz not null default now(),
  constraint memberships_user_org_key unique (user_id, org_id)
);

-- RolesGuard resolves (user_id, org_id) -> role on every role-gated request.
create index if not exists memberships_user_id_idx on memberships (user_id);
create index if not exists memberships_org_id_idx  on memberships (org_id);

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------

create table if not exists categories (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations (id) on delete cascade,
  name       text not null,
  icon       text,
  is_default boolean not null default false,
  constraint categories_org_name_key unique (org_id, name)
);

create index if not exists categories_org_id_idx on categories (org_id);

-- ---------------------------------------------------------------------------
-- expenses
-- ---------------------------------------------------------------------------

create table if not exists expenses (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations (id) on delete cascade,
  user_id          uuid not null references users (id) on delete restrict,
  category_id      uuid references categories (id) on delete set null,
  amount           numeric(14, 2) not null check (amount > 0),
  currency         text not null,
  -- PRD §6.5: the original amount is authoritative; converted_amount is the
  -- base-currency value at the historical rate, and stays null until FX runs.
  converted_amount numeric(14, 2),
  base_currency    text not null,
  merchant         text,
  note             text,
  status           expense_status not null default 'draft',
  receipt_url      text,
  expense_date     date not null,
  created_at       timestamptz not null default now(),
  -- Soft delete (PRD §6.2). Rows are never hard-deleted so the audit trail and
  -- approvals keep referential integrity.
  deleted_at       timestamptz
);

-- PRD §9 names org_id / user_id / expense_date explicitly.
create index if not exists expenses_org_id_idx       on expenses (org_id);
create index if not exists expenses_user_id_idx      on expenses (user_id);
create index if not exists expenses_expense_date_idx on expenses (expense_date);

-- The shape every list/dashboard query actually has: one org, newest first,
-- live rows only. Partial on deleted_at so soft-deleted rows cost nothing.
create index if not exists expenses_org_date_live_idx
  on expenses (org_id, expense_date desc)
  where deleted_at is null;

-- Approval queues and status filters.
create index if not exists expenses_org_status_live_idx
  on expenses (org_id, status)
  where deleted_at is null;

create index if not exists expenses_org_category_live_idx
  on expenses (org_id, category_id)
  where deleted_at is null;

-- Free-text search hits merchant and note with ILIKE '%term%'; btree cannot
-- serve a leading wildcard, trigram GIN can.
create index if not exists expenses_merchant_trgm_idx on expenses using gin (merchant gin_trgm_ops);
create index if not exists expenses_note_trgm_idx     on expenses using gin (note gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- budgets
-- ---------------------------------------------------------------------------

create table if not exists budgets (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations (id) on delete cascade,
  -- null category_id = the org-wide budget.
  category_id uuid references categories (id) on delete cascade,
  amount      numeric(14, 2) not null check (amount >= 0),
  period      budget_period not null default 'monthly',
  rollover    boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists budgets_org_id_idx on budgets (org_id);

-- One budget per category per org (and one org-wide row, since two nulls are
-- distinct in a plain unique index).
create unique index if not exists budgets_org_category_key
  on budgets (org_id, category_id) where category_id is not null;
create unique index if not exists budgets_org_overall_key
  on budgets (org_id) where category_id is null;

-- ---------------------------------------------------------------------------
-- approvals — one row per approve/reject decision (PRD §6.4 comment thread).
-- ---------------------------------------------------------------------------

create table if not exists approvals (
  id          uuid primary key default gen_random_uuid(),
  expense_id  uuid not null references expenses (id) on delete cascade,
  approver_id uuid not null references users (id) on delete restrict,
  status      expense_status not null check (status in ('approved', 'rejected')),
  comment     text,
  decided_at  timestamptz not null default now()
);

create index if not exists approvals_expense_id_idx on approvals (expense_id);
create index if not exists approvals_approver_id_idx on approvals (approver_id);

-- ---------------------------------------------------------------------------
-- audit_log — who changed what, when (PRD §6.2).
-- ---------------------------------------------------------------------------

create table if not exists audit_log (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations (id) on delete cascade,
  actor_id   uuid references users (id) on delete set null,
  action     text not null,
  entity     text not null,
  entity_id  uuid,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_org_created_idx on audit_log (org_id, created_at desc);
create index if not exists audit_log_entity_idx      on audit_log (entity, entity_id);

-- ---------------------------------------------------------------------------
-- notifications (PRD §6.7)
-- ---------------------------------------------------------------------------

create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users (id) on delete cascade,
  org_id     uuid references organizations (id) on delete cascade,
  type       text not null,
  payload    jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

-- The notification bell only ever asks for one user's unread rows.
create index if not exists notifications_user_unread_idx
  on notifications (user_id, created_at desc) where read_at is null;
create index if not exists notifications_user_id_idx on notifications (user_id);

-- ---------------------------------------------------------------------------
-- tool_call_log — every WebMCP tool invocation, human or agent (PRD §8.7).
-- Both the audit trail and the demo artifact.
-- ---------------------------------------------------------------------------

create table if not exists tool_call_log (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations (id) on delete cascade,
  -- Nullable: an unauthenticated/anonymous cross-origin demo call still logs.
  actor_id   uuid references users (id) on delete set null,
  actor      tool_call_actor not null,
  tool_name  text not null,
  input      jsonb,
  output     jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tool_call_log_org_created_idx on tool_call_log (org_id, created_at desc);
create index if not exists tool_call_log_org_actor_idx   on tool_call_log (org_id, actor, created_at desc);

-- ---------------------------------------------------------------------------
-- refresh_tokens
--
-- Not in the PRD §8.7 table list, but PRD §6.1 asks for a *rotating* refresh
-- token plus a session-management screen that can revoke devices. Both need
-- server-side state: only the token's jti and a hash of it are stored, never
-- the token itself. Rotation marks the old row revoked and records which jti
-- replaced it, so a replayed token is detectable rather than merely rejected.
-- ---------------------------------------------------------------------------

create table if not exists refresh_tokens (
  id             uuid primary key default gen_random_uuid(),
  jti            uuid not null unique,
  user_id        uuid not null references users (id) on delete cascade,
  org_id         uuid not null references organizations (id) on delete cascade,
  token_hash     text not null,
  user_agent     text,
  expires_at     timestamptz not null,
  revoked_at     timestamptz,
  replaced_by    uuid,
  created_at     timestamptz not null default now()
);

create index if not exists refresh_tokens_user_id_idx on refresh_tokens (user_id);
create index if not exists refresh_tokens_active_idx
  on refresh_tokens (user_id, expires_at) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- Lock everything down. No policies == no access for anon/authenticated keys;
-- the service role used by backend/ bypasses RLS entirely.
-- ---------------------------------------------------------------------------

alter table users          enable row level security;
alter table organizations  enable row level security;
alter table memberships    enable row level security;
alter table categories     enable row level security;
alter table expenses       enable row level security;
alter table budgets        enable row level security;
alter table approvals      enable row level security;
alter table audit_log      enable row level security;
alter table notifications  enable row level security;
alter table tool_call_log  enable row level security;
alter table refresh_tokens enable row level security;
