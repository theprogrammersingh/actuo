import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  FX_RATE_REPOSITORY,
  type FxRateRepository,
} from '../supabase/repositories.js';

/**
 * A rate, and the day it is actually from.
 *
 * `rateDate` is not always the day that was asked for — see `rateOn`. Callers
 * that persist a conversion must persist both, or the figure cannot be
 * defended later.
 */
export interface LockedRate {
  /** One unit of the `from` currency expressed in the `to` currency. */
  rate: number;
  rateDate: string;
}

/** Everything an expense row needs to record a conversion, ready to write. */
export interface LockedConversion extends LockedRate {
  convertedAmount: number;
}

/**
 * ECB rates via the Frankfurter API — deliberately the same publisher the
 * embedded converter shows (PRD §6.5), so the advisory widget and the ledger
 * agree without the ledger depending on the widget.
 *
 * The deadline is tighter than the 8s Supabase gets: this sits on the expense
 * save path, and a missing rate degrades to "excluded and counted" while a slow
 * save is felt immediately.
 */
const FX_API_BASE = process.env.FX_API_BASE ?? 'https://api.frankfurter.dev/v1';
const FX_TIMEOUT_MS = Number(process.env.FX_TIMEOUT_MS ?? 5000);
const FX_SOURCE = 'frankfurter/ecb';

@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);

  constructor(@Inject(FX_RATE_REPOSITORY) private readonly rates: FxRateRepository) {}

  /**
   * The rate for `from` -> `to` on `onDate`, or `null` if none could be had.
   *
   * **This never throws.** A missing rate is a normal outcome: the caller
   * writes nulls, the row is excluded and counted, and the backfill picks it up
   * later. A currency API being down must not stop someone filing an expense.
   *
   * `onDate` is what was asked for; `rateDate` is what the ECB published. They
   * differ on weekends and holidays — it publishes once per working day, so a
   * Sunday expense locks Friday's rate.
   */
  async rateOn(from: string, to: string, onDate: string): Promise<LockedRate | null> {
    const base = from.toUpperCase();
    const quote = to.toUpperCase();
    const asOfDate = isoDate(onDate);
    if (!asOfDate) return null;

    // Identity pair. Not an optimisation — Frankfurter rejects a request whose
    // base and symbol are the same, so this is the only correct answer, and it
    // is exact rather than a rounded round trip.
    if (base === quote) return { rate: 1, rateDate: asOfDate };

    const cached = await this.readCache(base, quote, asOfDate);
    if (cached) return cached;

    const fetched = await this.fetchRate(base, quote, asOfDate);
    if (!fetched) return null;

    // Cache write failures are not the caller's problem: we have the rate, and
    // the only cost is re-fetching it next time.
    try {
      await this.rates.save({ base, quote, asOfDate, ...fetched, source: FX_SOURCE });
    } catch (error) {
      this.logger.warn(`Could not cache ${base}->${quote} for ${asOfDate}: ${reason(error)}`);
    }

    return fetched;
  }

  /**
   * `rateOn`, applied to an amount and rounded for storage.
   *
   * The rounding lives here rather than in each caller because
   * `expenses.converted_amount` is `numeric(14,2)`: rounding in one place is
   * what stops a row's stored figure and a recomputed one from disagreeing in
   * the last paisa.
   */
  async lock(
    amount: number,
    from: string,
    to: string,
    onDate: string,
  ): Promise<LockedConversion | null> {
    const locked = await this.rateOn(from, to, onDate);
    if (!locked) return null;
    return { ...locked, convertedAmount: round2(amount * locked.rate) };
  }

  /**
   * A cached rate, if there is one that is still true.
   *
   * Staleness has exactly one case. A past day's ECB rate never changes, and
   * neither does a rate that resolved to the very day it was asked for. The
   * only entry that can go out of date is one for **today** that resolved
   * backwards — which is what happens before the ECB publishes at ~16:00 CET.
   * Treating that as permanent would pin yesterday's rate to today forever.
   */
  private async readCache(
    base: string,
    quote: string,
    asOfDate: string,
  ): Promise<LockedRate | null> {
    let cached;
    try {
      cached = await this.rates.find(base, quote, asOfDate);
    } catch (error) {
      // A cache read failing must not cost us the rate itself.
      this.logger.warn(`FX cache unreadable for ${base}->${quote}: ${reason(error)}`);
      return null;
    }
    if (!cached) return null;

    const resolvedBackwards = cached.rateDate !== cached.asOfDate;
    const notYetSettled = cached.asOfDate >= today();
    if (resolvedBackwards && notYetSettled) return null;

    return { rate: cached.rate, rateDate: cached.rateDate };
  }

  /**
   * One request to the rate publisher.
   *
   * The date goes in the path rather than using `/latest`, even for today: one
   * code path for every date, and the response's own `date` field tells us
   * which day we actually got. A future-dated expense resolves the same way,
   * backwards to the last publication.
   */
  private async fetchRate(
    base: string,
    quote: string,
    asOfDate: string,
  ): Promise<LockedRate | null> {
    const url = `${FX_API_BASE}/${asOfDate}?base=${base}&symbols=${quote}`;

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(FX_TIMEOUT_MS) });
      if (!response.ok) {
        // 404 is the normal answer for a currency the ECB does not publish.
        this.logger.warn(`FX lookup ${base}->${quote} on ${asOfDate}: HTTP ${response.status}`);
        return null;
      }

      const body = (await response.json()) as { date?: unknown; rates?: Record<string, unknown> };
      const rate = Number(body?.rates?.[quote]);
      const rateDate = isoDate(body?.date);

      // Validate rather than trust: a malformed body must not become a zero
      // rate, which would silently write a converted amount of 0.00 and read
      // as a real figure everywhere downstream.
      if (!rateDate || !Number.isFinite(rate) || rate <= 0) {
        this.logger.warn(`FX lookup ${base}->${quote} on ${asOfDate} returned an unusable body.`);
        return null;
      }

      return { rate, rateDate };
    } catch (error) {
      this.logger.warn(`FX lookup ${base}->${quote} on ${asOfDate} failed: ${reason(error)}`);
      return null;
    }
  }
}

/** Today in UTC, as YYYY-MM-DD — the same shape the dates being compared use. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Narrow a value to a `YYYY-MM-DD` date, or null.
 *
 * `expense_date` is a DATE column and the API path segment is a bare date, so
 * a timestamp has to be trimmed rather than passed through. The shape is
 * checked because these strings are concatenated into a URL.
 */
function isoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

/** Money rounds to 2dp; floats otherwise leak 0.30000000000000004. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
