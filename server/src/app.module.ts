import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { AuthModule } from './auth/auth.module';
import { LoadsModule } from './loads/loads.module';
import { BidsModule } from './bids/bids.module';
import { FuelModule } from './fuel/fuel.module';
import { CarrierModule } from './carrier/carrier.module';
import { DispatcherModule } from './dispatcher/dispatcher.module';
import { CopilotModule } from './copilot/copilot.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    IntegrationsModule,
    AuthModule,
    LoadsModule,
    BidsModule,
    FuelModule,
    CarrierModule,
    DispatcherModule,
    CopilotModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
