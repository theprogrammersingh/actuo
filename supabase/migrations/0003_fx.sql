-- Actuo — FX rates and the historical rate lock (PRD §6.5).
--
-- Two things, deliberately separate:
--
--   * `fx_rates` is a CACHE — nothing here cannot be re-fetched.
--   * `expenses.fx_rate` / `fx_rate_date` are a LOCK, and ledger data. Once
--     written they are never recomputed: the point of a historical lock is that
--     today's rate does not retroactively change what last month cost.
--
-- Rates are ECB, read through the Frankfurter API by backend/src/fx/. Nothing
-- the embedded converter displays reaches these columns — it is advisory and
-- has no channel back into the app.

begin;

-- fx_rates — the daily cache

create table if not exists fx_rates (
  base       text not null,
  quote      text not null,

  -- The date we ASKED for, and the date the rate we got is actually from.
  --
  -- They differ, and both matter. The ECB publishes once per working day, so a
  -- request for a Sunday resolves backwards: asking Frankfurter for 2026-08-16
  -- returns {"date":"2026-08-14", ...}. Recording only one of these would mean
  -- either losing the provenance of the rate or never being able to answer
  -- "what did we use for a Sunday expense" without re-deriving the weekend
  -- rule.
  --
  -- The primary key is on `as_of_date`, not `rate_date`, on purpose: keyed by
  -- rate_date, every Sunday lookup would miss the cache forever and re-fetch.
  as_of_date date not null,
  rate_date  date not null,

  -- Wide enough for both directions of a pair: 1 USD = 94.97 INR and
  -- 1 INR = 0.010530 USD both have to round-trip.
  rate       numeric(20, 10) not null check (rate > 0),

  -- So a future second publisher is distinguishable rather than mixed in.
  source     text not null default 'frankfurter/ecb',
  fetched_at timestamptz not null default now(),

  primary key (base, quote, as_of_date)
);

-- expenses — the historical rate lock

-- `converted_amount` has existed since 0001 but carried no rate and no date.
-- These make it auditable: a figure that can be re-derived and defended.
--
-- Null must stay allowed — it means "no rate could be locked", the state
-- sumSpend() and sumByCategory() already exclude and count rather than guess.
alter table expenses add column if not exists fx_rate      numeric(20, 10);
alter table expenses add column if not exists fx_rate_date date;

-- Same posture as every other table in 0001: no policies, so anon and
-- authenticated keys can read nothing, while the service role backend/ uses
-- bypasses RLS entirely.
alter table fx_rates enable row level security;

commit;
