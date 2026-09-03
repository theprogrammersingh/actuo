/**
 * Currency formatting for the app screens.
 *
 * Kept as one function rather than three copies: Dashboard, Expenses and
 * Budgets all render the same org base currency, and money that is grouped one
 * way on one screen and another way on the next reads as a bug.
 *
 * Formatting only. No rounding decisions, no currency conversion: the backend
 * sends `convertedAmount` in the org's base currency and that is what the UI
 * shows.
 */

/**
 * `en-IN` by default because the org base currency in the seed data is INR and
 * lakh grouping (₹1,24,500) is what the design doc's stat cards show. `Intl`
 * places the right symbol for any currency code regardless of locale, so this
 * only decides digit grouping.
 */
const DEFAULT_LOCALE = 'en-IN';

/** Whole rupees/dollars. Expense lists are scanned, not audited — cents are noise. */
export function formatMoney(amount: number, currency: string, locale = DEFAULT_LOCALE): string {
  if (!Number.isFinite(amount)) return '—';

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    // An unknown/blank currency code makes Intl throw. A number with no symbol
    // is still useful; a crashed table is not.
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount);
  }
}

/**
 * An FX rate, as a plain number with no currency symbol.
 *
 * Deliberately not `formatMoney`: that caps at whole units, which is right for
 * an expense list and useless for a rate — 95.27 would print as "₹95", and the
 * reverse direction (1 INR = 0.0105 USD) as "₹0". A rate is also not an amount
 * of money in either currency, so a symbol on it would be wrong as well as
 * imprecise; the caller names both currencies around it instead.
 */
export function formatRate(rate: number, locale = DEFAULT_LOCALE): string {
  if (!Number.isFinite(rate)) return '—';
  return new Intl.NumberFormat(locale, { maximumSignificantDigits: 6 }).format(rate);
}

/**
 * `2026-08-27` → `27 Aug`. Expense dates are date-only strings, so they are
 * split by hand: `new Date('2026-08-27')` parses as UTC midnight and renders as
 * the 26th for anyone west of Greenwich.
 */
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export function formatDay(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return isoDate;
  const [, , month, day] = match;
  const name = MONTHS[Number(month) - 1];
  return name ? `${Number(day)} ${name}` : isoDate;
}

/** Same split, plus the year — for the table, where rows can cross a year. */
export function formatDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return isoDate;
  const [, year] = match;
  const day = formatDay(isoDate);
  return day === isoDate ? isoDate : `${day} ${year}`;
}
