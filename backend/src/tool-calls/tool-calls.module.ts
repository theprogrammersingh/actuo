import { Module } from '@nestjs/common';
import { ToolCallsController } from './tool-calls.controller.js';
import { ToolCallLogService } from './tool-call-log.service.js';

/** Exported so any feature module can append to the log without a HTTP hop. */
@Module({
  controllers: [ToolCallsController],
  providers: [ToolCallLogService],
  exports: [ToolCallLogService],
})
export class ToolCallsModule {}
