/**
 * Locks a real ECB rate onto expenses that do not have one (PRD §6.5).
 *
 *   pnpm run backfill:fx                  # dry run, rows with no conversion
 *   pnpm run backfill:fx -- --restate     # dry run, also rows whose
 *                                         # converted_amount has no rate
 *   pnpm run backfill:fx -- --restate --apply
 *
 * Two populations, and they are different problems:
 *
 *   * **No conversion at all.** Excluded from every total and counted as such —
 *     honest but incomplete.
 *   * **A conversion with no rate** (`--restate`). Worse, because it is
 *     invisible: it counts toward every total and nothing says where it came
 *     from. The demo seed is exactly this, at hand-written rates (₹87/$ for
 *     Figma, ₹94/€ for Sentry) nobody published.
 *
 * Dry run by default. Nothing is written without `--apply`.
 *
 * It boots the real Nest context so it shares `FxService` (cache and weekend
 * rule) and the API's service-role client — no second conversion path to keep
 * in step. The queries are written out here rather than added to
 * `ExpenseRepository`, whose every method is org-scoped for tenant isolation;
 * an unscoped "all rows everywhere" read there would be one import away from a
 * request path.
 *
 * It lives under `backend/` because pnpm hoists nothing: a root script cannot
 * resolve `@nestjs/core`. Reads `dist/`, so `nest build` must have run.
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';
import { FxService } from '../dist/fx/fx.service.js';
import { SupabaseService } from '../dist/supabase/supabase.service.js';

const apply = process.argv.includes('--apply');
const restate = process.argv.includes('--restate');
const PAGE = 200;

const money = (value, currency) =>
  value === null || value === undefined
    ? '—'
    : `${currency} ${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

console.log(`\nFX backfill — ${apply ? 'APPLYING' : 'dry run'}${restate ? ', including rows to restate' : ''}\n`);

// Logs stay at error: a full pass warns once per unreachable rate, and the
// table below is the actual output.
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
const fx = app.get(FxService);
const db = app.get(SupabaseService).getClient();

/**
 * Rows that need a rate, oldest first.
 *
 * Paged by `id` rather than by offset: rows are updated as we go, and an
 * offset walk over a set that is shrinking under it skips rows.
 */
async function* rowsNeedingRates() {
  let after = '';

  for (;;) {
    let query = db
      .from('expenses')
      .select('id, org_id, amount, currency, converted_amount, fx_rate, base_currency, merchant, expense_date')
      .is('deleted_at', null)
      .is('fx_rate', null)
      .order('id', { ascending: true })
      .limit(PAGE);

    if (after) query = query.gt('id', after);
    if (!restate) query = query.is('converted_amount', null);

    const { data, error } = await query;
    if (error) throw new Error(`Could not read expenses: ${error.message}`);
    if (!data?.length) return;

    for (const row of data) yield row;
    after = data[data.length - 1].id;
    if (data.length < PAGE) return;
  }
}

let considered = 0;
let locked = 0;
let unchanged = 0;
const failed = [];

for await (const row of rowsNeedingRates()) {
  // Filtered here rather than in SQL: PostgREST cannot compare two columns in
  // a filter, and a same-currency row has nothing to look up.
  if (row.currency === row.base_currency) {
    unchanged += 1;
    continue;
  }
  considered += 1;

  const lock = await fx.lock(Number(row.amount), row.currency, row.base_currency, row.expense_date);
  if (!lock) {
    failed.push(row);
    continue;
  }

  const wasText = money(row.converted_amount, row.base_currency);
  const nowText = money(lock.convertedAmount, row.base_currency);
  const label = (row.merchant ?? 'Untitled').padEnd(18).slice(0, 18);
  console.log(
    `  ${row.expense_date}  ${label} ${money(row.amount, row.currency).padStart(14)}  ` +
      `${wasText.padStart(14)} -> ${nowText.padStart(14)}  @ ${lock.rate} on ${lock.rateDate}`,
  );

  if (apply) {
    const { error } = await db
      .from('expenses')
      .update({
        converted_amount: lock.convertedAmount,
        fx_rate: lock.rate,
        fx_rate_date: lock.rateDate,
      })
      .eq('id', row.id);
    if (error) throw new Error(`Could not update ${row.id}: ${error.message}`);
  }
  locked += 1;
}

console.log(
  `\n${locked} row(s) ${apply ? 'locked' : 'would be locked'}, ` +
    `${unchanged} already in the base currency, ${failed.length} without a rate.`,
);

if (failed.length) {
  console.log('\nNo rate could be found for these — they stay excluded and counted:');
  for (const row of failed) {
    console.log(`  ${row.id}  ${row.expense_date}  ${row.currency}  ${row.merchant ?? ''}`);
  }
}

if (!apply && locked) console.log('\nNothing was written. Re-run with --apply.');

await app.close();
