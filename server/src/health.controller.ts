import { Controller, Get } from '@nestjs/common';
import { IntegrationsService } from './integrations/integrations.service';

@Controller()
export class HealthController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      activeProviders: this.integrations.activeProviders(),
      time: new Date().toISOString(),
    };
  }
}
