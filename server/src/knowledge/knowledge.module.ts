import { Global, Module } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeController } from './knowledge.controller';

// Global so the Co-Pilot (and anything else) can inject KnowledgeService to pull
// carrier memory + freight know-how into a reply without importing this module.
@Global()
@Module({
  providers: [KnowledgeService],
  controllers: [KnowledgeController],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
