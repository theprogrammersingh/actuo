import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';

/**
 * Read-only. Appending is done by the service that made the change, straight
 * through `AUDIT_LOG_REPOSITORY`, so there is nothing to export here.
 */
@Module({
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditModule {}
