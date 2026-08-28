/**
 * JSON Schema -> Gemini `Schema` conversion.
 *
 * Gemini's function-calling schema dialect is a **subset of OpenAPI 3.0**, not
 * JSON Schema. It rejects (or silently ignores) a number of keywords our
 * `@actuo/shared` tool contracts genuinely use:
 *
 * | our contracts use   | Gemini                                     |
 * |---------------------|--------------------------------------------|
 * | `additionalProperties: false` | rejected — must be removed       |
 * | `format: 'date'`    | rejected — only `date-time` / `enum` on STRING |
 * | `default: 20`       | ignored — the model never sees it          |
 * | `exclusiveMinimum`  | not in the dialect                         |
 * | `type: 'string'`    | wants the enum name, `STRING`              |
 *
 * Dropping a keyword silently would make the model *less* capable (it would
 * stop knowing that `expenseDate` is `YYYY-MM-DD`, or that `limit` defaults to
 * 20). So anything we cannot express structurally is folded into the
 * `description` instead, where the model still reads it.
 */

/** The Gemini `Schema` subset we emit. */
export interface GeminiSchema {
  type?: 'STRING' | 'NUMBER' | 'INTEGER' | 'BOOLEAN' | 'ARRAY' | 'OBJECT';
  format?: string;
  title?: string;
  description?: string;
  nullable?: boolean;
  enum?: string[];
  items?: GeminiSchema;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
  propertyOrdering?: string[];
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minProperties?: number;
  maxProperties?: number;
  pattern?: string;
  anyOf?: GeminiSchema[];
}

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters?: GeminiSchema;
}

/** What callers hand us for each tool the model may call. */
export interface GeminiToolDeclaration {
  name: string;
  description: string;
  /** Plain JSON Schema, e.g. `ActuoToolContract.inputSchema` from `@actuo/shared`. */
  inputSchema?: unknown;
}

type JsonType = 'STRING' | 'NUMBER' | 'INTEGER' | 'BOOLEAN' | 'ARRAY' | 'OBJECT';

const TYPE_MAP: Readonly<Record<string, JsonType>> = {
  string: 'STRING',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
  array: 'ARRAY',
  object: 'OBJECT',
};

/** `format` values Gemini accepts, keyed by the type they are valid for. */
const SUPPORTED_FORMATS: Readonly<Record<string, ReadonlySet<string>>> = {
  STRING: new Set(['date-time', 'enum']),
  NUMBER: new Set(['float', 'double']),
  INTEGER: new Set(['int32', 'int64']),
};

/**
 * Human-readable hints for the `format` values Gemini drops, so the constraint
 * survives into the description instead of vanishing.
 */
const FORMAT_HINTS: Readonly<Record<string, string>> = {
  date: 'Format: a calendar date as YYYY-MM-DD.',
  time: 'Format: a time of day as HH:MM:SS.',
  duration: 'Format: an ISO 8601 duration.',
  email: 'Format: an email address.',
  uri: 'Format: an absolute URI.',
  url: 'Format: an absolute URL.',
  uuid: 'Format: a UUID.',
};

/**
 * Keywords dropped outright — Gemini has no equivalent and rejects or ignores
 * them. Exported so the conversion tests can assert none of them survive.
 */
export const DROPPED_SCHEMA_KEYWORDS: ReadonlySet<string> = new Set([
  'additionalProperties',
  'unevaluatedProperties',
  '$schema',
  '$id',
  '$ref',
  '$defs',
  '$comment',
  'definitions',
  'examples',
  'deprecated',
  'readOnly',
  'writeOnly',
  'contentEncoding',
  'contentMediaType',
  'patternProperties',
  'dependentRequired',
  'if',
  'then',
  'else',
  'not',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asPositiveInt(value: unknown): number | undefined {
  const n = asNumber(value);
  return n !== undefined && n >= 0 ? n : undefined;
}

function describeValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function resolveType(raw: Record<string, unknown>): { type?: JsonType; nullable: boolean } {
  const declared = raw['type'];
  let nullable = false;
  let candidate: unknown = declared;

  if (Array.isArray(declared)) {
    const named = declared.filter((t): t is string => typeof t === 'string');
    nullable = named.includes('null');
    candidate = named.find((t) => t !== 'null');
  }

  if (typeof candidate === 'string') {
    const mapped = TYPE_MAP[candidate.toLowerCase()];
    if (mapped) return { type: mapped, nullable };
  }

  // No usable `type`: infer from structure, the way OpenAPI generators do.
  if (isRecord(raw['properties'])) return { type: 'OBJECT', nullable };
  if (raw['items'] !== undefined) return { type: 'ARRAY', nullable };
  if (Array.isArray(raw['enum'])) return { type: 'STRING', nullable };
  return { type: undefined, nullable };
}

/**
 * Converts one plain JSON Schema node into Gemini's dialect.
 *
 * Returns `undefined` for input that is not an object schema at all (e.g.
 * `true`, `null`, a string), which callers treat as "no parameters".
 */
export function toGeminiSchema(input: unknown): GeminiSchema | undefined {
  if (!isRecord(input)) return undefined;

  const raw = input;
  const { type, nullable } = resolveType(raw);
  const out: GeminiSchema = {};
  const hints: string[] = [];

  if (type) out.type = type;
  if (nullable || raw['nullable'] === true) out.nullable = true;

  if (typeof raw['title'] === 'string') out.title = raw['title'];

  // --- format -------------------------------------------------------------
  const format = raw['format'];
  if (typeof format === 'string' && format) {
    const allowed = type ? SUPPORTED_FORMATS[type] : undefined;
    if (allowed?.has(format)) {
      out.format = format;
    } else {
      hints.push(FORMAT_HINTS[format] ?? `Format: ${format}.`);
    }
  }

  // --- enum / const -------------------------------------------------------
  const enumValues = Array.isArray(raw['enum'])
    ? raw['enum']
    : raw['const'] !== undefined
      ? [raw['const']]
      : undefined;
  if (enumValues && enumValues.length > 0) {
    if (!type || type === 'STRING') {
      out.type = 'STRING';
      out.enum = enumValues.map((v) => String(v));
    } else {
      // Gemini only supports enums on STRING; keep the real type and tell the
      // model about the allowed values in prose.
      hints.push(`Allowed values: ${enumValues.map((v) => describeValue(v)).join(', ')}.`);
    }
  }

  // --- numeric / length constraints --------------------------------------
  const minimum = asNumber(raw['minimum']);
  if (minimum !== undefined) out.minimum = minimum;
  const maximum = asNumber(raw['maximum']);
  if (maximum !== undefined) out.maximum = maximum;

  const exclusiveMinimum = asNumber(raw['exclusiveMinimum']);
  if (exclusiveMinimum !== undefined) hints.push(`Must be greater than ${exclusiveMinimum}.`);
  const exclusiveMaximum = asNumber(raw['exclusiveMaximum']);
  if (exclusiveMaximum !== undefined) hints.push(`Must be less than ${exclusiveMaximum}.`);
  const multipleOf = asNumber(raw['multipleOf']);
  if (multipleOf !== undefined) hints.push(`Must be a multiple of ${multipleOf}.`);

  const minLength = asPositiveInt(raw['minLength']);
  if (minLength !== undefined) out.minLength = minLength;
  const maxLength = asPositiveInt(raw['maxLength']);
  if (maxLength !== undefined) out.maxLength = maxLength;
  const minItems = asPositiveInt(raw['minItems']);
  if (minItems !== undefined) out.minItems = minItems;
  const maxItems = asPositiveInt(raw['maxItems']);
  if (maxItems !== undefined) out.maxItems = maxItems;
  const minProperties = asPositiveInt(raw['minProperties']);
  if (minProperties !== undefined) out.minProperties = minProperties;
  const maxProperties = asPositiveInt(raw['maxProperties']);
  if (maxProperties !== undefined) out.maxProperties = maxProperties;

  if (typeof raw['pattern'] === 'string') out.pattern = raw['pattern'];

  // --- default ------------------------------------------------------------
  // Gemini ignores `default`, which would quietly cost the model real
  // information ("limit defaults to 20"). Fold it into the description.
  if (raw['default'] !== undefined) {
    hints.push(`Defaults to ${describeValue(raw['default'])}.`);
  }

  // --- children -----------------------------------------------------------
  if (isRecord(raw['properties'])) {
    const properties: Record<string, GeminiSchema> = {};
    const ordering: string[] = [];
    for (const [key, value] of Object.entries(raw['properties'])) {
      const child = toGeminiSchema(value);
      if (child) {
        properties[key] = child;
        ordering.push(key);
      }
    }
    if (ordering.length > 0) {
      out.properties = properties;
      // Nudges Gemini toward emitting args in our declared order, which makes
      // tool-call cards read consistently.
      out.propertyOrdering = ordering;
      if (!out.type) out.type = 'OBJECT';
    }
  }

  if (raw['items'] !== undefined) {
    const items = toGeminiSchema(raw['items']);
    if (items) out.items = items;
  }

  const variants = raw['anyOf'] ?? raw['oneOf'];
  if (Array.isArray(variants)) {
    const converted = variants
      .map((variant) => toGeminiSchema(variant))
      .filter((variant): variant is GeminiSchema => variant !== undefined);
    if (converted.length > 0) out.anyOf = converted;
  }

  // `required` is only meaningful for keys we actually kept.
  if (Array.isArray(raw['required'])) {
    const required = raw['required']
      .filter((name): name is string => typeof name === 'string')
      .filter((name) => !out.properties || name in out.properties);
    if (required.length > 0) out.required = required;
  }

  // --- description (last, so hints append to the author's prose) ----------
  const description = typeof raw['description'] === 'string' ? raw['description'].trim() : '';
  const combined = [description, ...hints].filter(Boolean).join(' ');
  if (combined) out.description = combined;

  // Everything in DROPPED_SCHEMA_KEYWORDS is, by construction, never copied
  // above — this function only ever writes keys it recognises.
  return out;
}

/**
 * True when a converted schema carries nothing Gemini can use as a parameter
 * list. Gemini rejects an OBJECT with an empty `properties` map, so these must
 * be sent as "no parameters" rather than as `{}`.
 */
export function isEmptyParameterSchema(schema: GeminiSchema | undefined): boolean {
  if (!schema) return true;
  if (schema.properties && Object.keys(schema.properties).length > 0) return false;
  if (schema.anyOf && schema.anyOf.length > 0) return false;
  return schema.type === undefined || schema.type === 'OBJECT';
}

/** Converts one tool contract into a Gemini `functionDeclaration`. */
export function toFunctionDeclaration(tool: GeminiToolDeclaration): GeminiFunctionDeclaration {
  const parameters = toGeminiSchema(tool.inputSchema);
  const declaration: GeminiFunctionDeclaration = {
    name: tool.name,
    description: tool.description,
  };
  if (!isEmptyParameterSchema(parameters) && parameters) {
    declaration.parameters = parameters;
  }
  return declaration;
}

export function toFunctionDeclarations(
  tools: readonly GeminiToolDeclaration[],
): GeminiFunctionDeclaration[] {
  return tools.map((tool) => toFunctionDeclaration(tool));
}
