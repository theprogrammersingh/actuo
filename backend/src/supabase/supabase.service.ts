import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { EnvService, MissingEnvError } from '../config/env.service.js';

/**
 * The one and only Supabase client in the system (PRD §8.2 data boundary).
 *
 * The client is created **lazily**, on first `getClient()`. That is the whole
 * point of this class: `backend/.env` is blank until the user pastes their
 * credentials, and the service must still build, boot, serve `/api/health` and
 * `/api/config`, and pass the whole test suite without them. Constructing the
 * client in the constructor — or worse, at module scope — would turn a missing
 * env var into a crash-on-startup and a red test run.
 *
 * What you get instead is a 503 with the variable name in it, on exactly the
 * requests that needed a database.
 */
@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  private client?: SupabaseClient;

  constructor(private readonly env: EnvService) {}

  get isConfigured(): boolean {
    return this.env.supabaseConfigured;
  }

  getClient(): SupabaseClient {
    if (this.client) return this.client;

    let url: string;
    let serviceRoleKey: string;
    try {
      ({ url, serviceRoleKey } = this.env.requireSupabase());
    } catch (error) {
      if (error instanceof MissingEnvError) {
        this.logger.error(error.message);
        // 503, not 500: the service is fine, its dependency is unconfigured.
        throw new ServiceUnavailableException(
          'Supabase is not configured on this server. Set SUPABASE_URL and ' +
            'SUPABASE_SERVICE_ROLE_KEY in backend/.env.',
        );
      }
      throw error;
    }

    this.client = createClient(url, serviceRoleKey, {
      auth: {
        // This is a server process holding a service-role key. There is no
        // browser session to persist and no token to auto-refresh; leaving
        // these on keeps timers alive and stops the process from exiting.
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    this.logger.log('Supabase client initialised (service role).');
    return this.client;
  }
}
