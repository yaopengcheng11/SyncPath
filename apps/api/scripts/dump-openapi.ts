/**
 * Dump the OpenAPI document for the running API to
 * packages/contracts/openapi.json without binding a port.
 *
 * Run with:
 *   cd apps/api && npm run openapi:dump
 *
 * This is the canonical way to refresh the spec; main.ts also writes the
 * same file on boot as a safety net.
 */
import 'reflect-metadata';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
// Use the Nest-CLI compiled module. The CLI plugin adds the reflected
// parameter metadata that @nestjs/swagger needs for custom parameter
// decorators; importing the raw TypeScript source through tsx skips that
// transformation and makes Swagger document generation fail.
// `npm run openapi:dump` builds the API before invoking this script.
// eslint-disable-next-line @typescript-eslint/no-require-imports
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AppModule } = require('../dist/app.module') as {
  AppModule: typeof import('../src/app.module').AppModule;
};

async function dump(): Promise<void> {
  // `create()` returns a NestFastifyApplication that has an HTTP adapter
  // (required by SwaggerModule); we just never call `app.listen()`.
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
    { logger: ['warn', 'error'] }
  );
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  try {
    const config = new DocumentBuilder()
      .setTitle('SyncPath API')
      .setDescription('SyncPath backend — DEV-006 OpenAPI snapshot')
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

    const document = SwaggerModule.createDocument(app, config);

    const outPath = resolve(
      process.cwd(),
      '../../packages/contracts/openapi.json'
    );
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(document, null, 2));
    // eslint-disable-next-line no-console
    console.log(`OpenAPI document written: ${outPath}`);
    // eslint-disable-next-line no-console
    console.log(`  ${document.paths ? Object.keys(document.paths).length : 0} paths`);
    // eslint-disable-next-line no-console
    console.log(
      `  ${document.components?.schemas ? Object.keys(document.components.schemas).length : 0} schemas`
    );
  } finally {
    await app.close();
  }
}

dump().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to dump OpenAPI document:', err);
  process.exit(1);
});
