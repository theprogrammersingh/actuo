import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';

@Controller('health')
export class HealthController {
  /**
   * Unauthenticated by necessity: Firebase App Hosting's health probe has no
   * credentials. It reports only that the process is up — deliberately not
   * whether Supabase is reachable, since a database blip should not take the
   * instance out of rotation while it is still serving the Angular app.
   */
  @Public()
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'actuo-backend',
      time: new Date().toISOString(),
    };
  }
}
