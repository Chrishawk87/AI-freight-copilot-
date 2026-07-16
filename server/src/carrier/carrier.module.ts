import { Module } from '@nestjs/common';
import { CarrierController } from './carrier.controller';
import { EmailOauthController } from './email-oauth.controller';
import { EmailOauthService } from './email-oauth.service';

@Module({
  controllers: [CarrierController, EmailOauthController],
  providers: [EmailOauthService],
  exports: [EmailOauthService],
})
export class CarrierModule {}
