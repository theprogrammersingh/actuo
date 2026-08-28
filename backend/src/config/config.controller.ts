import { Controller, Get } from '@nestjs/common';
import { CURRENCIES } from '@actuo/shared';
import { Public } from '../auth/public.decorator.js';
import { EnvService } from './env.service.js';

export interface GeminiModelOption {
  id: string;
  label: string;
  /** The one the settings screen preselects. */
  recommended: boolean;
}

export interface ClientConfig {
  geminiModels: GeminiModelOption[];
  defaultGeminiModel: string;
  baseCurrency: string;
  currencies: readonly string[];
}

/**
 * Non-secret configuration the browser needs at runtime.
 *
 * This endpoint exists for one reason (PRD §11 flags it as a live risk):
 * **Gemini's model line-up churns.** Hardcoding model ids in the Angular
 * bundle means a rebuild-and-redeploy every time Google renames or retires
 * one. Serving the list here makes it editable server-side.
 *
 * NOTE FOR ANYONE EXTENDING THIS: there is no API key here, and there must
 * never be one. The user's Gemini key lives in browser storage and goes
 * straight from the browser to Google (PRD §8.3 / CLAUDE.md rule 2). This
 * endpoint returns *model identifiers*, which are public strings.
 */
@Controller('config')
export class ConfigController {
  constructor(private readonly env: EnvService) {}

  @Public()
  @Get()
  get(): ClientConfig {
    return {
      geminiModels: [
        { id: 'gemini-3-pro', label: 'Gemini 3 Pro', recommended: false },
        { id: 'gemini-3-flash', label: 'Gemini 3 Flash', recommended: true },
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', recommended: false },
      ],
      // Flash is the default: the Copilot loop is many small function-calling
      // round-trips, where latency matters more than reasoning depth.
      defaultGeminiModel: 'gemini-3-flash',
      baseCurrency: this.env.baseCurrency,
      currencies: CURRENCIES,
    };
  }
}
