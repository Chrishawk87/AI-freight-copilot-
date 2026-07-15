import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  const origin = process.env.CORS_ORIGIN || 'http://localhost:3000';
  app.enableCors({ origin: origin.split(','), credentials: true });

  const port = Number(process.env.PORT) || 4000;
  // Bind to 0.0.0.0 so the container is reachable on Railway (not just loopback).
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`AI Freight Co-Pilot API running on port ${port} (prefix /api)`);
}
bootstrap();
