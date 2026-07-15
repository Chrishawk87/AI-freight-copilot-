import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Scanned documents arrive as base64 image payloads, which blow past Express's
  // default 100kb JSON limit. Allow up to 15mb so a phone photo goes through.
  app.use(json({ limit: '15mb' }));
  app.use(urlencoded({ extended: true, limit: '15mb' }));

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
