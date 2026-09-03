import { Module } from '@nestjs/common';
import { FxService } from './fx.service.js';

/**
 * No controller. Rates are not a public surface — they are read on the write
 * path of an expense and by the backfill script, and exposing them would
 * invite a client to convert a figure and send it back, which is exactly the
 * boundary PRD §6.5 draws.
 */
@Module({
  providers: [FxService],
  exports: [FxService],
})
export class FxModule {}
