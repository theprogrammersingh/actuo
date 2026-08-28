import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';
import { Public } from './auth/public.decorator.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /**
   * `GET /api` — the root of the API namespace. Public: it proves the prefix is
   * mounted (see `test/routing-contract.e2e-spec.ts`) and reveals nothing.
   */
  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
