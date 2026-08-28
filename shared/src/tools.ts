/**
 * WebMCP tool contracts (PRD §7).
 *
 * Each tool's `inputSchema` is plain JSON Schema, defined once here so the
 * client-side registration and the server-side validation cannot drift
 * (PRD §9: "input validation matching WebMCP JSON schemas on both client
 * and server").
 *
 * Registration itself lives in the frontend — these are only the contracts.
 */

/** Mirrors WebMCP.ToolAnnotations from `webmcp-types`. */
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
}

export interface ActuoToolContract {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: ToolAnnotations;
  /**
   * Whether the Copilot must show an in-chat Confirm/Cancel card before
   * executing (Design Doc §3.2.4). True for anything that moves money or
   * changes approval state.
   */
  requiresConfirmation: boolean;
}

export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'SGD', 'AUD'] as const;

export const EXPENSE_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'reimbursed',
] as const;

export const SEARCH_EXPENSES: ActuoToolContract = {
  name: 'search_expenses',
  title: 'Search expenses',
  description:
    'Search this organization\'s expenses by free text, category, status, or date range. Returns a paginated list. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Free text matched against merchant and note.' },
      status: { type: 'string', enum: [...EXPENSE_STATUSES], description: 'Filter by approval status.' },
      from: { type: 'string', format: 'date', description: 'Earliest expense date, YYYY-MM-DD.' },
      to: { type: 'string', format: 'date', description: 'Latest expense date, YYYY-MM-DD.' },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  requiresConfirmation: false,
};

export const SUBMIT_EXPENSE: ActuoToolContract = {
  name: 'submit_expense',
  title: 'Submit an expense',
  description:
    'Create an expense and submit it for approval. Use when the user describes a purchase they want recorded.',
  inputSchema: {
    type: 'object',
    properties: {
      amount: { type: 'number', exclusiveMinimum: 0, description: 'Amount in the given currency.' },
      currency: { type: 'string', enum: [...CURRENCIES], default: 'INR' },
      merchant: { type: 'string', description: 'Where the money was spent.' },
      category: { type: 'string', description: 'Category name, e.g. "Travel" or "Dining".' },
      note: { type: 'string' },
      expenseDate: { type: 'string', format: 'date', description: 'YYYY-MM-DD. Defaults to today.' },
    },
    required: ['amount', 'currency'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false },
  requiresConfirmation: true,
};

export const GET_BUDGET_STATUS: ActuoToolContract = {
  name: 'get_budget_status',
  title: 'Get budget status',
  description:
    'Report how much of each budget has been spent this period, with remaining amounts and utilization. Read-only.',
  inputSchema: {
    type: 'object',
    properties: {
      category: { type: 'string', description: 'Limit to one category by name. Omit for all.' },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  requiresConfirmation: false,
};

/**
 * Long-running on purpose — this is the tool that demonstrates AbortSignal
 * cancellation (PRD §7). Its execute() must poll `options.signal`.
 */
export const GENERATE_REPORT: ActuoToolContract = {
  name: 'generate_report',
  title: 'Generate an expense report',
  description:
    'Generate a CSV expense report for a date range. Long-running; can be cancelled while in progress.',
  inputSchema: {
    type: 'object',
    properties: {
      from: { type: 'string', format: 'date' },
      to: { type: 'string', format: 'date' },
      format: { type: 'string', enum: ['csv', 'pdf'], default: 'csv' },
    },
    required: ['from', 'to'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  requiresConfirmation: false,
};

/**
 * State-gated (PRD §7): only registered when the signed-in user is an
 * admin/owner AND at least one expense is awaiting approval. Registration and
 * unregistration fire `toolchange`.
 */
export const APPROVE_EXPENSE: ActuoToolContract = {
  name: 'approve_expense',
  title: 'Approve or reject an expense',
  description:
    'Approve or reject a submitted expense. Only available to admins and owners while items are pending.',
  inputSchema: {
    type: 'object',
    properties: {
      expenseId: { type: 'string', description: 'The expense to decide on.' },
      decision: { type: 'string', enum: ['approved', 'rejected'] },
      comment: { type: 'string' },
    },
    required: ['expenseId', 'decision'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false },
  requiresConfirmation: true,
};

/** Every tool except the state-gated one, which registers conditionally. */
export const ALWAYS_ON_TOOLS: readonly ActuoToolContract[] = [
  SEARCH_EXPENSES,
  SUBMIT_EXPENSE,
  GET_BUDGET_STATUS,
  GENERATE_REPORT,
] as const;

export const ALL_TOOL_CONTRACTS: readonly ActuoToolContract[] = [
  ...ALWAYS_ON_TOOLS,
  APPROVE_EXPENSE,
] as const;
