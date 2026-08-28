-- Actuo — demo seed (PRD §9 "seed script for demo data").
--
-- Deterministic UUIDs so the seed is idempotent (every insert is
-- `on conflict do nothing`) and so the frontend demo script can deep-link to
-- known rows. Dates are relative to current_date, so the dashboard, budget
-- bars and search all look alive whenever this is run.
--
-- Demo credentials (both users): Demo1234!
--   owner  — priya@actuo.demo   (role: owner)
--   member — arjun@actuo.demo   (role: member)
-- The hashes below are real argon2id hashes of that password, so
-- POST /api/auth/login works against a freshly seeded database.

begin;

-- ---------------------------------------------------------------------------
-- Org + users + memberships
-- ---------------------------------------------------------------------------

insert into organizations (id, name, base_currency, created_at) values
  ('11111111-1111-4111-8111-111111111111', 'Northwind Studio', 'INR', now() - interval '120 days')
on conflict (id) do nothing;

insert into users (id, email, password_hash, name, created_at) values
  ('22222222-2222-4222-8222-222222222221', 'priya@actuo.demo',
   '$argon2id$v=19$m=65536,p=4,t=3$B9WJlRScxVSYX0YpbkuNXA$lSsF047U9qv+fCC+Y81QXnh/iZXYo8tNHUqGf7wFncE',
   'Priya Nair', now() - interval '120 days'),
  ('22222222-2222-4222-8222-222222222222', 'arjun@actuo.demo',
   '$argon2id$v=19$m=65536,p=4,t=3$tSxK9Kg9olXbVCEvfyaTRQ$P2m/cWEkMdcvc9LliZVHNvXejHIl+5bmhNo0F+FwwwE',
   'Arjun Mehta', now() - interval '95 days')
on conflict (id) do nothing;

insert into memberships (id, user_id, org_id, role, joined_at) values
  ('33333333-3333-4333-8333-333333333331', '22222222-2222-4222-8222-222222222221',
   '11111111-1111-4111-8111-111111111111', 'owner',  now() - interval '120 days'),
  ('33333333-3333-4333-8333-333333333332', '22222222-2222-4222-8222-222222222222',
   '11111111-1111-4111-8111-111111111111', 'member', now() - interval '95 days')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------

insert into categories (id, org_id, name, icon, is_default) values
  ('44444444-4444-4444-8444-444444444441', '11111111-1111-4111-8111-111111111111', 'Travel',          'plane',    true),
  ('44444444-4444-4444-8444-444444444442', '11111111-1111-4111-8111-111111111111', 'Meals',           'utensils', true),
  ('44444444-4444-4444-8444-444444444443', '11111111-1111-4111-8111-111111111111', 'Software',        'laptop',   true),
  ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 'Office Supplies', 'box',      true),
  ('44444444-4444-4444-8444-444444444445', '11111111-1111-4111-8111-111111111111', 'Marketing',       'megaphone', true),
  ('44444444-4444-4444-8444-444444444446', '11111111-1111-4111-8111-111111111111', 'Training',        'book',     true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Budgets — sized so GET /api/budgets/status shows a healthy spread:
-- one category comfortably under, one near the 80% alert line, one over.
-- ---------------------------------------------------------------------------

insert into budgets (id, org_id, category_id, amount, period, rollover) values
  ('55555555-5555-4555-8555-555555555551', '11111111-1111-4111-8111-111111111111',
   '44444444-4444-4444-8444-444444444441', 60000.00, 'monthly', false),
  ('55555555-5555-4555-8555-555555555552', '11111111-1111-4111-8111-111111111111',
   '44444444-4444-4444-8444-444444444442', 15000.00, 'monthly', false),
  ('55555555-5555-4555-8555-555555555553', '11111111-1111-4111-8111-111111111111',
   '44444444-4444-4444-8444-444444444443', 25000.00, 'monthly', true),
  ('55555555-5555-4555-8555-555555555554', '11111111-1111-4111-8111-111111111111',
   '44444444-4444-4444-8444-444444444444',  8000.00, 'monthly', false),
  ('55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111',
   '44444444-4444-4444-8444-444444444445', 40000.00, 'monthly', false),
  -- org-wide ceiling (category_id null)
  ('55555555-5555-4555-8555-555555555556', '11111111-1111-4111-8111-111111111111',
   null, 180000.00, 'monthly', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Expenses — 26 rows across the last 60 days, all six categories and all five
-- statuses, split between the owner and the member. Dates are relative so the
-- "this month" dashboard and the 60-day trend are both populated.
-- ---------------------------------------------------------------------------

insert into expenses (
  id, org_id, user_id, category_id, amount, currency, converted_amount,
  base_currency, merchant, note, status, expense_date, created_at, deleted_at
) values
  -- ---- current month: the ones the dashboard and budget bars read ----
  ('66666666-6666-4666-8666-000000000001', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444442',   840.00, 'INR',   840.00, 'INR', 'Third Wave Coffee',  'Client catch-up',                'approved',   current_date - 1,  now() - interval '1 day',  null),
  ('66666666-6666-4666-8666-000000000002', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444441',  6450.00, 'INR',  6450.00, 'INR', 'Uber',               'Airport transfer, Mumbai pitch',  'submitted',  current_date - 2,  now() - interval '2 days', null),
  ('66666666-6666-4666-8666-000000000003', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222221', '44444444-4444-4444-8444-444444444443',    20.00, 'USD',  1740.00, 'INR', 'Figma',              'Design seat, monthly',            'approved',   current_date - 3,  now() - interval '3 days', null),
  ('66666666-6666-4666-8666-000000000004', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444442',  2310.00, 'INR',  2310.00, 'INR', 'Toit Brewpub',       'Team dinner, sprint close',       'submitted',  current_date - 4,  now() - interval '4 days', null),
  ('66666666-6666-4666-8666-000000000005', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222221', '44444444-4444-4444-8444-444444444445', 18500.00, 'INR', 18500.00, 'INR', 'Google Ads',         'Q3 launch campaign',              'approved',   current_date - 5,  now() - interval '5 days', null),
  ('66666666-6666-4666-8666-000000000006', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444444',  1290.00, 'INR',  1290.00, 'INR', 'Amazon Business',    'Whiteboard markers, sticky notes','draft',      current_date - 6,  now() - interval '6 days', null),
  ('66666666-6666-4666-8666-000000000007', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222221', '44444444-4444-4444-8444-444444444443',    99.00, 'USD',  8613.00, 'INR', 'Vercel',             'Pro plan',                        'reimbursed', current_date - 8,  now() - interval '8 days', null),
  ('66666666-6666-4666-8666-000000000008', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444441', 12400.00, 'INR', 12400.00, 'INR', 'IndiGo',             'BLR-BOM return, client onsite',   'approved',   current_date - 9,  now() - interval '9 days', null),
  ('66666666-6666-4666-8666-000000000009', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444442',  1150.00, 'INR',  1150.00, 'INR', 'Swiggy',             'Late-night release food',         'rejected',   current_date - 10, now() - interval '10 days', null),
  ('66666666-6666-4666-8666-000000000010', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222221', '44444444-4444-4444-8444-444444444446',  4999.00, 'INR',  4999.00, 'INR', 'Frontend Masters',   'Annual team licence',             'approved',   current_date - 11, now() - interval '11 days', null),
  ('66666666-6666-4666-8666-000000000011', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444442',  3480.00, 'INR',  3480.00, 'INR', 'Blue Tokai',         'Offsite breakfast',               'submitted',  current_date - 12, now() - interval '12 days', null),
  ('66666666-6666-4666-8666-000000000012', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222221', '44444444-4444-4444-8444-444444444445', 22750.00, 'INR', 22750.00, 'INR', 'LinkedIn Ads',       'Hiring campaign, senior eng',     'approved',   current_date - 14, now() - interval '14 days', null),
  ('66666666-6666-4666-8666-000000000013', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444441',  3200.00, 'INR',  3200.00, 'INR', 'Rapido',             'Daily commute, client site',      'reimbursed', current_date - 16, now() - interval '16 days', null),
  ('66666666-6666-4666-8666-000000000014', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222221', '44444444-4444-4444-8444-444444444443',    12.00, 'EUR',  1128.00, 'INR', 'Sentry',             'Error tracking, team plan',       'approved',   current_date - 18, now() - interval '18 days', null),
  ('66666666-6666-4666-8666-000000000015', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444444',  2650.00, 'INR',  2650.00, 'INR', 'Urban Ladder',       'Standing desk riser',             'approved',   current_date - 20, now() - interval '20 days', null),

  -- ---- previous month: gives month-over-month deltas something to compare ----
  ('66666666-6666-4666-8666-000000000016', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444442',  1890.00, 'INR',  1890.00, 'INR', 'Zomato',             'Sprint retro lunch',              'reimbursed', current_date - 24, now() - interval '24 days', null),
  ('66666666-6666-4666-8666-000000000017', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222221', '44444444-4444-4444-8444-444444444441', 28900.00, 'INR', 28900.00, 'INR', 'Taj Hotels',         'Conference stay, 2 nights',       'reimbursed', current_date - 27, now() - interval '27 days', null),
  ('66666666-6666-4666-8666-000000000018', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444443',    15.00, 'USD',  1305.00, 'INR', 'Notion',             'Extra workspace seats',           'approved',   current_date - 30, now() - interval '30 days', null),
  ('66666666-6666-4666-8666-000000000019', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222221', '44444444-4444-4444-8444-444444444445',  9800.00, 'INR',  9800.00, 'INR', 'Canva',              'Brand asset refresh',             'approved',   current_date - 33, now() - interval '33 days', null),
  ('66666666-6666-4666-8666-000000000020', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444444',   740.00, 'INR',   740.00, 'INR', 'Staples',            'Printer paper',                   'reimbursed', current_date - 36, now() - interval '36 days', null),
  ('66666666-6666-4666-8666-000000000021', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444441',  5600.00, 'INR',  5600.00, 'INR', 'Ola',                'Client visit, Whitefield',        'rejected',   current_date - 39, now() - interval '39 days', null),
  ('66666666-6666-4666-8666-000000000022', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222221', '44444444-4444-4444-8444-444444444446', 14500.00, 'INR', 14500.00, 'INR', 'Udemy Business',     'Onboarding curriculum',           'approved',   current_date - 42, now() - interval '42 days', null),
  ('66666666-6666-4666-8666-000000000023', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444442',  2075.00, 'INR',  2075.00, 'INR', 'Chai Point',         'Office pantry restock',           'reimbursed', current_date - 46, now() - interval '46 days', null),
  ('66666666-6666-4666-8666-000000000024', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222221', '44444444-4444-4444-8444-444444444443',    49.00, 'USD',  4263.00, 'INR', 'GitHub',             'Team plan, 7 seats',              'reimbursed', current_date - 50, now() - interval '50 days', null),
  ('66666666-6666-4666-8666-000000000025', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444441',  7300.00, 'INR',  7300.00, 'INR', 'IRCTC',              'Chennai workshop, train',         'approved',   current_date - 55, now() - interval '55 days', null),
  ('66666666-6666-4666-8666-000000000026', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222221', '44444444-4444-4444-8444-444444444445', 11200.00, 'INR', 11200.00, 'INR', 'Meta Ads',           'Retargeting test',                'reimbursed', current_date - 59, now() - interval '59 days', null),

  -- One soft-deleted row, so "deleted expenses stay out of every list" is
  -- observable in the demo rather than merely asserted.
  ('66666666-6666-4666-8666-0000000000ff', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '44444444-4444-4444-8444-444444444444',   999.00, 'INR',   999.00, 'INR', 'Duplicate Entry',    'Entered twice by mistake',        'draft',      current_date - 7,  now() - interval '7 days', now() - interval '6 days')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Approvals — the decision records behind the approved/rejected rows above.
-- ---------------------------------------------------------------------------

insert into approvals (id, expense_id, approver_id, status, comment, decided_at) values
  ('77777777-7777-4777-8777-000000000001', '66666666-6666-4666-8666-000000000009',
   '22222222-2222-4222-8222-222222222221', 'rejected', 'Outside the meal policy — please resubmit under Travel.', now() - interval '9 days'),
  ('77777777-7777-4777-8777-000000000002', '66666666-6666-4666-8666-000000000008',
   '22222222-2222-4222-8222-222222222221', 'approved', 'Client onsite, pre-agreed.', now() - interval '8 days'),
  ('77777777-7777-4777-8777-000000000003', '66666666-6666-4666-8666-000000000021',
   '22222222-2222-4222-8222-222222222221', 'rejected', 'No receipt attached.', now() - interval '38 days'),
  ('77777777-7777-4777-8777-000000000004', '66666666-6666-4666-8666-000000000015',
   '22222222-2222-4222-8222-222222222221', 'approved', null, now() - interval '19 days')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Notifications (PRD §6.7) — one unread approval request, one read budget alert.
-- ---------------------------------------------------------------------------

insert into notifications (id, user_id, org_id, type, payload, read_at, created_at) values
  ('88888888-8888-4888-8888-000000000001', '22222222-2222-4222-8222-222222222221',
   '11111111-1111-4111-8111-111111111111', 'approval_requested',
   '{"expenseId":"66666666-6666-4666-8666-000000000002","merchant":"Uber","amount":6450}'::jsonb,
   null, now() - interval '2 days'),
  ('88888888-8888-4888-8888-000000000002', '22222222-2222-4222-8222-222222222221',
   '11111111-1111-4111-8111-111111111111', 'budget_threshold',
   '{"categoryId":"44444444-4444-4444-8444-444444444442","threshold":0.8}'::jsonb,
   now() - interval '3 days', now() - interval '4 days'),
  ('88888888-8888-4888-8888-000000000003', '22222222-2222-4222-8222-222222222222',
   '11111111-1111-4111-8111-111111111111', 'expense_rejected',
   '{"expenseId":"66666666-6666-4666-8666-000000000009"}'::jsonb,
   null, now() - interval '9 days')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- tool_call_log — a short, believable session mixing human clicks and agent
-- calls, so GET /api/tool-calls?actor=agent has something to show on a cold
-- database.
-- ---------------------------------------------------------------------------

insert into tool_call_log (id, org_id, actor_id, actor, tool_name, input, output, created_at) values
  ('99999999-9999-4999-8999-000000000001', '11111111-1111-4111-8111-111111111111',
   '22222222-2222-4222-8222-222222222222', 'human', 'submit_expense',
   '{"amount":840,"currency":"INR","merchant":"Third Wave Coffee"}'::jsonb,
   '{"id":"66666666-6666-4666-8666-000000000001","status":"submitted"}'::jsonb,
   now() - interval '1 day'),
  ('99999999-9999-4999-8999-000000000002', '11111111-1111-4111-8111-111111111111',
   '22222222-2222-4222-8222-222222222221', 'agent', 'search_expenses',
   '{"query":"uber","status":"submitted"}'::jsonb,
   '{"total":1}'::jsonb,
   now() - interval '20 hours'),
  ('99999999-9999-4999-8999-000000000003', '11111111-1111-4111-8111-111111111111',
   '22222222-2222-4222-8222-222222222221', 'agent', 'get_budget_status',
   '{}'::jsonb,
   '{"overBudget":["Marketing"]}'::jsonb,
   now() - interval '19 hours'),
  ('99999999-9999-4999-8999-000000000004', '11111111-1111-4111-8111-111111111111',
   '22222222-2222-4222-8222-222222222221', 'agent', 'approve_expense',
   '{"expenseId":"66666666-6666-4666-8666-000000000008"}'::jsonb,
   '{"status":"approved"}'::jsonb,
   now() - interval '18 hours'),
  ('99999999-9999-4999-8999-000000000005', '11111111-1111-4111-8111-111111111111',
   '22222222-2222-4222-8222-222222222221', 'human', 'generate_report',
   '{"period":"last_30_days"}'::jsonb,
   '{"rows":18}'::jsonb,
   now() - interval '2 hours')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------

insert into audit_log (id, org_id, actor_id, action, entity, entity_id, metadata, created_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000001', '11111111-1111-4111-8111-111111111111',
   '22222222-2222-4222-8222-222222222221', 'org.created', 'organization',
   '11111111-1111-4111-8111-111111111111', '{}'::jsonb, now() - interval '120 days'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000002', '11111111-1111-4111-8111-111111111111',
   '22222222-2222-4222-8222-222222222221', 'member.invited', 'membership',
   '33333333-3333-4333-8333-333333333332', '{"role":"member"}'::jsonb, now() - interval '95 days'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000003', '11111111-1111-4111-8111-111111111111',
   '22222222-2222-4222-8222-222222222221', 'expense.approved', 'expense',
   '66666666-6666-4666-8666-000000000008', '{"from":"submitted","to":"approved"}'::jsonb, now() - interval '8 days'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-000000000004', '11111111-1111-4111-8111-111111111111',
   '22222222-2222-4222-8222-222222222222', 'expense.deleted', 'expense',
   '66666666-6666-4666-8666-0000000000ff', '{"soft":true}'::jsonb, now() - interval '6 days')
on conflict (id) do nothing;

commit;
