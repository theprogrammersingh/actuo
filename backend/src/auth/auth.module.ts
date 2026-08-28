import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

/**
 * `JwtModule.register({})` takes no secret on purpose.
 *
 * Configuring the secret here would read `JWT_ACCESS_SECRET` at module
 * construction, which happens on every `createNestApp()` — including the one
 * in `routing-contract.e2e-spec.ts`, against the blank `.env` this repo ships.
 * Instead every `signAsync`/`verifyAsync` call passes its own `secret`, so a
 * missing key fails the *request* with a clear message rather than the boot.
 *
 * It also keeps the access and refresh secrets genuinely separate: they are
 * different keys for different token types, and a single module-level default
 * would quietly make one of them the fallback for both.
 *
 * Global so `JwtAuthGuard` (registered as an APP_GUARD in AppModule) can inject
 * `JwtService` without AppModule importing this module's internals.
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
