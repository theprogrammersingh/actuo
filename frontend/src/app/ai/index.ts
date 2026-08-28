/**
 * BYOK Gemini layer. The user's key is stored in this browser and sent only to
 * `https://generativelanguage.googleapis.com` — never to Actuo's backend
 * (CLAUDE.md rule 2, PRD §8.3).
 */

export { KeyStore, maskApiKey, KEY_STORAGE_KEY, MODEL_STORAGE_KEY } from './key-store';

export {
  ModelCatalog,
  DEFAULT_GEMINI_MODELS,
  DEFAULT_GEMINI_MODEL_ID,
  labelForModelId,
  parseModelConfig,
} from './models';
export type { GeminiModelOption, ModelSource } from './models';

export { GeminiClient } from './gemini-client';
export type { GeminiGenerateRequest, GeminiRequestOptions, ToolMode } from './gemini-client';

export { testGeminiKey } from './test-key';
export type { KeyTestParams, KeyTestResult } from './test-key';

export {
  GeminiError,
  isGeminiError,
  redactKey,
  errorFromResponse,
  errorFromThrown,
  noKeyError,
} from './gemini-errors';
export type { GeminiErrorKind, GeminiErrorInit } from './gemini-errors';

export {
  toGeminiSchema,
  toFunctionDeclaration,
  toFunctionDeclarations,
  isEmptyParameterSchema,
  DROPPED_SCHEMA_KEYWORDS,
} from './gemini-schema';
export type {
  GeminiSchema,
  GeminiFunctionDeclaration,
  GeminiToolDeclaration,
} from './gemini-schema';

export {
  turnsToContents,
  parseGenerateContentResponse,
  normalizeFunctionResponse,
} from './gemini-protocol';
export type {
  GeminiTurn,
  GeminiFunctionCall,
  GeminiFunctionResult,
  GeminiGenerateResult,
  GeminiUsage,
  WireContent,
  WirePart,
  WireGenerateContentRequest,
  WireGenerateContentResponse,
} from './gemini-protocol';

export {
  GEMINI_FETCH,
  GEMINI_API_ORIGIN,
  GEMINI_API_VERSION,
  GEMINI_API_KEY_HEADER,
  geminiUrl,
  assertGeminiUrl,
  callGemini,
} from './gemini-transport';
export type { FetchLike, GeminiEndpoint, GeminiCallOptions } from './gemini-transport';
