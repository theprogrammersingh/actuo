import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPENSE_PAGE_DEFAULT, EXPENSE_PAGE_MAX } from './dto.js';

const ROOT = new URL('../../', import.meta.url).pathname;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

describe('page-limit contract', () => {
  it('has sane values', () => {
    expect(EXPENSE_PAGE_DEFAULT).toBeLessThanOrEqual(EXPENSE_PAGE_MAX);
    expect(EXPENSE_PAGE_MAX).toBeGreaterThan(0);
  });

  /**
   * This cap was previously written out by hand in six places. Two drifted: the
   * Expenses page asked for 200 and got a 400, and report generation asked for
   * 500 and was silently clamped, producing incomplete CSVs.
   *
   * A literal limit is how that happens, so it fails the build here. If you
   * genuinely need a different page size, import the constant and derive from
   * it — do not write a number.
   */
  /**
   * This cap was previously written out by hand in six places. Two drifted: the
   * Expenses page asked for 200 and got a 400, and report generation asked for
   * 500 and was silently clamped, producing incomplete CSVs.
   *
   * A literal page size on an expenses call is how that happens, so it fails
   * here. Need a different size? Import the constant and derive from it.
   *
   * Scoped deliberately to files that talk to `/expenses`: rate limits, the
   * tool-call log (its own cap, its own resource) and local slice counts are
   * different numbers that happen to share the word.
   */
  it('is never hardcoded as a literal on an expenses call', () => {
    const roots = [join(ROOT, 'backend/src'), join(ROOT, 'frontend/src/app')];
    const offenders: string[] = [];

    for (const root of roots) {
      for (const file of sourceFiles(root)) {
        const text = readFileSync(file, 'utf8');
        if (!text.includes('/expenses') && !text.includes('ExpenseQuery')) continue;

        for (const [i, raw] of text.split('\n').entries()) {
          const line = raw.trim();
          if (line.startsWith('*') || line.startsWith('//') || line.startsWith('/*')) continue;
          if (line.includes('RateLimit')) continue;

          const match = /\blimit\s*[:=]\s*(\d+)/.exec(line);
          if (match && Number(match[1]) > 1) {
            offenders.push(`${file.replace(ROOT, '')}:${i + 1} — ${line}`);
          }
        }
      }
    }

    expect(offenders, `hardcoded expense page limits:\n${offenders.join('\n')}`).toEqual([]);
  });
});
