import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication
} from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/http/api-exception.filter';

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({
    logger: process.env.NODE_ENV === 'production' ? false : true,
    trustProxy: true
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    { bufferLogs: false }
  );

  // Standard error envelope (docs §6.1).
  app.useGlobalFilters(new ApiExceptionFilter());

  // Cookie plugin — required for session auth.
  await app.register(fastifyCookie as never, {
    secret: process.env.SESSION_SECRET ?? 'dev-only-secret'
  } as never);

  // Versioned API prefix.
  // All routes registered via @Controller('api/v1/...') land under /api/v1.
  // The /health probe is excluded so monitoring tools can hit it directly.
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  // OpenAPI document (docs §6.1). The CLI plugin in nest-cli.json
  // auto-generates @ApiProperty() from TypeScript types, so controllers
  // and DTOs only need @ApiTags / @ApiOperation explicitly.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('SyncPath API')
    .setDescription(
      'SyncPath backend — see docs/SYNCPATH_DEVELOPMENT_FRAMEWORK_ACCEPTANCE.md §6.1'
    )
    .setVersion('0.1.0')
    .addCookieAuth('syncpath_session', { type: 'apiKey', in: 'cookie' }, 'syncpath_session')
    .addTag('health', 'Liveness probe')
    .addTag('identity', 'Sessions, registration, current user')
    .addTag('workspaces', 'Workspace CRUD + membership')
    .addTag('projects', 'Project CRUD (DEV-008)')
    .addTag('entries', 'Progress entries (WorkLog successor)')
    .addTag('mentions', 'Project member mentions and personal notifications')
    .addTag('imports', 'Legacy JSON import (DEV-007)')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);

  // Expose the document at /api/docs-json (used by the web proxy too).
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json'
  });

  // Dump the document on every boot — keeps the checked-in copy in sync
  // with the runtime schema. The npm script `openapi:dump` does the same
  // without binding a port.
  const dumpPath = resolve(
    process.cwd(),
    '../../packages/contracts/openapi.json'
  );
  mkdirSync(dirname(dumpPath), { recursive: true });
  writeFileSync(dumpPath, JSON.stringify(document, null, 2));

  const host = process.env.API_HOST ?? '127.0.0.1';
  const port = Number(process.env.API_PORT ?? 3160);

  await app.listen(port, host);

  // eslint-disable-next-line no-console
  console.log(
    `SyncPath API listening on http://${host}:${port}\n` +
      `OpenAPI:  http://${host}:${port}/api/docs-json\n` +
      `Swagger UI: http://${host}:${port}/api/docs\n` +
      `Spec dumped to: ${dumpPath}`
  );
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
