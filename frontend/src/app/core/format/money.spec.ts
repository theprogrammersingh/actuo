import { describe, expect, it } from 'vitest';

import { formatDate, formatDay, formatMoney, formatRate } from './money.js';

describe('formatMoney', () => {
  it('renders whole units with the currency’s own symbol', () => {
    expect(formatMoney(1908.6, 'INR')).toContain('1,909');
    expect(formatMoney(20, 'USD')).toContain('20');
  });

  it('falls back to a bare number rather than throwing on a bad code', () => {
    expect(formatMoney(1234, '')).toBe('1,234');
  });

  it('is a dash for a value that is not a number', () => {
    expect(formatMoney(Number.NaN, 'INR')).toBe('—');
  });
});

describe('formatRate', () => {
  it('keeps the decimals a rate needs, which formatMoney would round away', () => {
    // formatMoney caps at whole units — 95.43 would print as "₹95", which is
    // not the rate that was used.
    expect(formatRate(95.43)).toBe('95.43');
  });

  it('survives the reverse direction of a pair', () => {
    // 1 INR = 0.0105 USD. Rounded to whole units this would be "0".
    expect(formatRate(0.010530062)).toBe('0.0105301');
  });

  it('carries no currency symbol, because a rate is not an amount', () => {
    expect(formatRate(95.43)).not.toMatch(/[₹$€]/);
  });

  it('is a dash for a value that is not a number', () => {
    expect(formatRate(Number.NaN)).toBe('—');
  });
});

describe('formatDay / formatDate', () => {
  it('reads a date-only string by hand, so it does not shift a day west of UTC', () => {
    expect(formatDay('2026-08-14')).toBe('14 Aug');
    expect(formatDate('2026-08-14')).toBe('14 Aug 2026');
  });

  it('passes anything it cannot parse straight through', () => {
    expect(formatDate('soon')).toBe('soon');
  });
});
