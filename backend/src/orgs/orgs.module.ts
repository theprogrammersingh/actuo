import { Module } from '@nestjs/common';
import { OrgsController } from './orgs.controller.js';

/**
 * Read-only for now. Invite-by-email (PRD §6.1) is Phase 1 work: it needs a
 * transactional email provider and an invite-token table, neither of which is
 * in Phase 0's scope. Signup creates the org and its owner, and the seed
 * migration provides the second member the demo needs.
 */
@Module({
  controllers: [OrgsController],
})
export class OrgsModule {}
