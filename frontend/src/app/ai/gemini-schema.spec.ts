import { describe, expect, it } from 'vitest';
import { ALL_TOOL_CONTRACTS, SEARCH_EXPENSES, SUBMIT_EXPENSE } from '@actuo/shared';
import {
  DROPPED_SCHEMA_KEYWORDS,
  isEmptyParameterSchema,
  toFunctionDeclaration,
  toFunctionDeclarations,
  toGeminiSchema,
  type GeminiSchema,
} from './gemini-schema';

/** Every node in a converted schema, so assertions can sweep the whole tree. */
function walk(schema: GeminiSchema): GeminiSchema[] {
  const nodes: GeminiSchema[] = [schema];
  for (const child of Object.values(schema.properties ?? {})) nodes.push(...walk(child));
  if (schema.items) nodes.push(...walk(schema.items));
  for (const variant of schema.anyOf ?? []) nodes.push(...walk(variant));
  return nodes;
}

const VALID_TYPES = new Set(['STRING', 'NUMBER', 'INTEGER', 'BOOLEAN', 'ARRAY', 'OBJECT']);

const VALID_FORMATS: Record<string, ReadonlySet<string>> = {
  STRING: new Set(['date-time', 'enum']),
  NUMBER: new Set(['float', 'double']),
  INTEGER: new Set(['int32', 'int64']),
};

describe('toGeminiSchema', () => {
  describe('the real @actuo/shared tool contracts', () => {
    it('has contracts that actually exercise the unsupported keywords', () => {
      // Guards the premise of this whole file: if the shared contracts stop
      // using additionalProperties/format/default, this conversion stops being
      // load-bearing and someone should know.
      const json = JSON.stringify(ALL_TOOL_CONTRACTS);
      expect(json).toContain('"additionalProperties":false');
      expect(json).toContain('"format":"date"');
      expect(json).toContain('"default"');
    });

    it.each(ALL_TOOL_CONTRACTS.map((contract) => [contract.name, contract] as const))(
      '%s converts to a schema Gemini accepts',
      (_name, contract) => {
        const schema = toGeminiSchema(contract.inputSchema);
        expect(schema).toBeDefined();

        for (const node of walk(schema!)) {
          // Type is the OpenAPI enum name, uppercase.
          if (node.type !== undefined) expect(VALID_TYPES).toContain(node.type);

          // No JSON-Schema-only keyword survives anywhere in the tree.
          for (const keyword of Object.keys(node)) {
            expect(DROPPED_SCHEMA_KEYWORDS.has(keyword)).toBe(false);
          }
          expect(node).not.toHaveProperty('additionalProperties');
          expect(node).not.toHaveProperty('default');
          expect(node).not.toHaveProperty('exclusiveMinimum');
          expect(node).not.toHaveProperty('$schema');

          // Only formats Gemini recognises for that type remain.
          if (node.format !== undefined) {
            expect(VALID_FORMATS[node.type ?? '']).toBeDefined();
            expect(VALID_FORMATS[node.type ?? '']!.has(node.format)).toBe(true);
          }

          // `required` may only name properties that still exist.
          for (const name of node.required ?? []) {
            expect(node.properties ?? {}).toHaveProperty(name);
          }
        }

        // Round-trips through JSON — no undefined holes, no cycles.
        expect(() => JSON.stringify(schema)).not.toThrow();
      },
    );

    it('converts search_expenses field by field', () => {
      const schema = toGeminiSchema(SEARCH_EXPENSES.inputSchema)!;

      expect(schema.type).toBe('OBJECT');
      expect(Object.keys(schema.properties ?? {})).toEqual([
        'query',
        'status',
        'from',
        'to',
        'limit',
      ]);

      // enum survives, uppercased type, values stringified
      expect(schema.properties!['status']).toMatchObject({
        type: 'STRING',
        enum: ['draft', 'submitted', 'approved', 'rejected', 'reimbursed'],
      });

      // `format: 'date'` is not in Gemini's dialect: dropped from the schema,
      // preserved as prose so the model still emits YYYY-MM-DD.
      const from = schema.properties!['from']!;
      expect(from.format).toBeUndefined();
      expect(from.description).toContain('YYYY-MM-DD');

      // `default` is ignored by Gemini, so it moves into the description.
      const limit = schema.properties!['limit']!;
      expect(limit.type).toBe('INTEGER');
      expect(limit.minimum).toBe(1);
      expect(limit.maximum).toBe(100);
      expect(limit.description).toContain('Defaults to 20');
    });

    it('converts submit_expense, keeping required and folding exclusiveMinimum into prose', () => {
      const schema = toGeminiSchema(SUBMIT_EXPENSE.inputSchema)!;

      expect(schema.required).toEqual(['amount', 'currency']);

      const amount = schema.properties!['amount']!;
      expect(amount.type).toBe('NUMBER');
      expect(amount).not.toHaveProperty('exclusiveMinimum');
      expect(amount.description).toContain('Must be greater than 0');

      const currency = schema.properties!['currency']!;
      expect(currency.enum).toContain('INR');
      expect(currency.description).toContain('Defaults to INR.');
    });
  });

  describe('type handling', () => {
    it('uppercases every JSON Schema type', () => {
      for (const [json, gemini] of Object.entries({
        string: 'STRING',
        number: 'NUMBER',
        integer: 'INTEGER',
        boolean: 'BOOLEAN',
        array: 'ARRAY',
        object: 'OBJECT',
      })) {
        expect(toGeminiSchema({ type: json })?.type).toBe(gemini);
      }
    });

    it('turns a nullable union type into type + nullable', () => {
      expect(toGeminiSchema({ type: ['string', 'null'] })).toMatchObject({
        type: 'STRING',
        nullable: true,
      });
    });

    it('infers OBJECT from properties and ARRAY from items', () => {
      expect(toGeminiSchema({ properties: { a: { type: 'string' } } })?.type).toBe('OBJECT');
      expect(toGeminiSchema({ items: { type: 'string' } })?.type).toBe('ARRAY');
    });

    it('recurses into array items', () => {
      const schema = toGeminiSchema({
        type: 'array',
        items: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false },
      })!;
      expect(schema.items?.type).toBe('OBJECT');
      expect(schema.items).not.toHaveProperty('additionalProperties');
    });

    it('maps oneOf to anyOf', () => {
      const schema = toGeminiSchema({ oneOf: [{ type: 'string' }, { type: 'integer' }] })!;
      expect(schema.anyOf?.map((v) => v.type)).toEqual(['STRING', 'INTEGER']);
    });

    it('returns undefined for input that is not an object schema', () => {
      expect(toGeminiSchema(undefined)).toBeUndefined();
      expect(toGeminiSchema(null)).toBeUndefined();
      expect(toGeminiSchema(true)).toBeUndefined();
      expect(toGeminiSchema('string')).toBeUndefined();
      expect(toGeminiSchema([{ type: 'string' }])).toBeUndefined();
    });
  });

  describe('format handling', () => {
    it('keeps the formats Gemini supports for the given type', () => {
      expect(toGeminiSchema({ type: 'string', format: 'date-time' })?.format).toBe('date-time');
      expect(toGeminiSchema({ type: 'integer', format: 'int64' })?.format).toBe('int64');
      expect(toGeminiSchema({ type: 'number', format: 'double' })?.format).toBe('double');
    });

    it('drops a format that is valid JSON Schema but not valid for that Gemini type', () => {
      // int32 is only legal on INTEGER.
      expect(toGeminiSchema({ type: 'string', format: 'int32' })?.format).toBeUndefined();
    });

    it('explains a dropped format in the description rather than losing it', () => {
      const withPriorText = toGeminiSchema({
        type: 'string',
        format: 'date',
        description: 'Earliest expense date.',
      })!;
      expect(withPriorText.description).toBe(
        'Earliest expense date. Format: a calendar date as YYYY-MM-DD.',
      );

      expect(toGeminiSchema({ type: 'string', format: 'email' })?.description).toContain(
        'email address',
      );
      // Unknown formats still get a generic note.
      expect(toGeminiSchema({ type: 'string', format: 'ipv4' })?.description).toContain(
        'Format: ipv4.',
      );
    });
  });

  describe('constraint handling', () => {
    it('strips additionalProperties at every level', () => {
      const schema = toGeminiSchema({
        type: 'object',
        additionalProperties: false,
        properties: {
          nested: { type: 'object', additionalProperties: false, properties: { a: { type: 'string' } } },
        },
      })!;
      expect(schema).not.toHaveProperty('additionalProperties');
      expect(schema.properties!['nested']).not.toHaveProperty('additionalProperties');
    });

    it('strips $schema, $id and $ref', () => {
      const schema = toGeminiSchema({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: 'urn:actuo:test',
        $ref: '#/$defs/other',
        type: 'object',
        properties: { a: { type: 'string' } },
      })!;
      expect(schema).not.toHaveProperty('$schema');
      expect(schema).not.toHaveProperty('$id');
      expect(schema).not.toHaveProperty('$ref');
    });

    it('keeps minimum/maximum and length bounds', () => {
      expect(toGeminiSchema({ type: 'integer', minimum: 1, maximum: 100 })).toMatchObject({
        minimum: 1,
        maximum: 100,
      });
      expect(toGeminiSchema({ type: 'string', minLength: 2, maxLength: 9, pattern: '^a' })).toMatchObject(
        { minLength: 2, maxLength: 9, pattern: '^a' },
      );
    });

    it('drops required entries whose property was not kept', () => {
      const schema = toGeminiSchema({
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['a', 'ghost'],
      })!;
      expect(schema.required).toEqual(['a']);
    });

    it('keeps an enum on a non-string type in prose instead of a rejected enum field', () => {
      const schema = toGeminiSchema({ type: 'integer', enum: [1, 2, 3] })!;
      expect(schema.type).toBe('INTEGER');
      expect(schema.enum).toBeUndefined();
      expect(schema.description).toContain('Allowed values: 1, 2, 3.');
    });

    it('treats const as a single-value enum', () => {
      expect(toGeminiSchema({ type: 'string', const: 'csv' })?.enum).toEqual(['csv']);
    });

    it('records propertyOrdering from the declared property order', () => {
      const schema = toGeminiSchema({
        type: 'object',
        properties: { z: { type: 'string' }, a: { type: 'string' } },
      })!;
      expect(schema.propertyOrdering).toEqual(['z', 'a']);
    });
  });

  describe('toFunctionDeclaration', () => {
    it('produces one declaration per shared contract', () => {
      const declarations = toFunctionDeclarations(
        ALL_TOOL_CONTRACTS.map((c) => ({
          name: c.name,
          description: c.description,
          inputSchema: c.inputSchema,
        })),
      );

      expect(declarations.map((d) => d.name)).toEqual([
        'search_expenses',
        'submit_expense',
        'get_budget_status',
        'get_spend_summary',
        'generate_report',
        'download_report',
        'fetch_categories',
        'navigate_to',
        'set_budget',
        'approve_expense',
      ]);
      for (const declaration of declarations) {
        expect(declaration.description.length).toBeGreaterThan(0);
        // Tools with inputs have parameters; `get_spend_summary` and `fetch_categories` have none.
        if (declaration.name === 'get_spend_summary' || declaration.name === 'fetch_categories') {
          expect(declaration.parameters).toBeUndefined();
        } else {
          expect(declaration.parameters?.type).toBe('OBJECT');
        }
      }
    });

    it('omits parameters entirely for a tool with no inputs', () => {
      // Gemini rejects an OBJECT schema with an empty properties map.
      expect(
        toFunctionDeclaration({ name: 'ping', description: 'Ping.', inputSchema: undefined }),
      ).toEqual({ name: 'ping', description: 'Ping.' });

      expect(
        toFunctionDeclaration({
          name: 'ping',
          description: 'Ping.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        }),
      ).not.toHaveProperty('parameters');
    });

    it('isEmptyParameterSchema recognises schemas with nothing to fill in', () => {
      expect(isEmptyParameterSchema(undefined)).toBe(true);
      expect(isEmptyParameterSchema({ type: 'OBJECT' })).toBe(true);
      expect(isEmptyParameterSchema({ type: 'OBJECT', properties: { a: {} } })).toBe(false);
    });
  });
});
