import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { AuthModule } from './auth/auth.module';
import { LoadsModule } from './loads/loads.module';
import { BidsModule } from './bids/bids.module';
import { FuelModule } from './fuel/fuel.module';
import { CarrierModule } from './carrier/carrier.module';
import { DispatcherModule } from './dispatcher/dispatcher.module';
import { CopilotModule } from './copilot/copilot.module';
import { DocumentsModule } from './documents/documents.module';
import { UsageModule } from './usage/usage.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    IntegrationsModule,
    AuthModule,
    LoadsModule,
    BidsModule,
    FuelModule,
    CarrierModule,
    DispatcherModule,
    CopilotModule,
    DocumentsModule,
    UsageModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
