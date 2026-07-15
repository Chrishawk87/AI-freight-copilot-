import { Global, Module } from '@nestjs/common';
import { UsageService } from './usage.service';
import { UsageController } from './usage.controller';

// Global so any feature (documents, copilot) can inject UsageService to meter
// its calls without importing this module explicitly.
@Global()
@Module({
  providers: [UsageService],
  controllers: [UsageController],
  exports: [UsageService],
})
export class UsageModule {}
