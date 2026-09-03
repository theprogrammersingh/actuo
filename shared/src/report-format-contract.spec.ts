import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GENERATE_REPORT } from './tools.js';

const ROOT = new URL('../../', import.meta.url).pathname;

/**
 * The report format must mean the same thing at every layer that accepts it.
 *
 * `pdf` was advertised in the tool schema and validated by the DTO, then
 * dropped — the service always builds CSV. Worst in the tool schema: an agent
 * offered `pdf` picks it. These pin the two ends together.
 */
describe('report format contract', () => {
  const formatSchema = (
    GENERATE_REPORT.inputSchema as {
      properties: { format?: { enum?: string[]; default?: string } };
    }
  ).properties.format;

  it('offers a model only formats the server can actually produce', () => {
    expect(formatSchema?.enum).toEqual(['csv']);
  });

  it('defaults to a value it also allows', () => {
    expect(formatSchema?.enum).toContain(formatSchema?.default);
  });

  /** Read from source: `shared` must not depend on `backend`. */
  it('matches the formats the backend DTO will accept', () => {
    const dto = readFileSync(`${ROOT}backend/src/reports/dto/report.dto.ts`, 'utf8');
    const match = dto.match(/@IsIn\(\[([^\]]*)\]/);
    expect(match, 'no @IsIn on ReportQueryDto.format').not.toBeNull();

    const accepted = [...match![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(accepted).toEqual(formatSchema?.enum);
  });
});
