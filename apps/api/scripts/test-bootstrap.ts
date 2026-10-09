import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import { assertIntegrationEnvironment, redactDatabaseUrls } from './integration-safety';

// Reuse the compiled application, including Nest decorator metadata, without
// main.ts's OpenAPI export or the developer's listening port.
const { AppModule } = require('../dist/app.module') as { AppModule: typeof import('../src/app.module').AppModule };
const { ApiExceptionFilter } = require('../dist/common/http/api-exception.filter') as {
  ApiExceptionFilter: typeof import('../src/common/http/api-exception.filter').ApiExceptionFilter;
};

async function bootstrap(): Promise<void> {
  const target = assertIntegrationEnvironment(process.env);
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: false, trustProxy: false }), { logger: ['warn', 'error'] });
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.register(fastifyCookie as never, { secret: process.env.SESSION_SECRET } as never);
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.getHttpAdapter().getInstance().get('/__integration_probe', async (request, reply) => {
    if (request.headers['x-syncpath-test-token'] !== target.token) return reply.code(403).send({ code: 'test_probe_denied' });
    return { token: target.token, database: target.databaseName };
  });
  let closing = false;
  const close = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', () => { void close(); });
  process.once('SIGTERM', () => { void close(); });
  await app.listen(target.port, '127.0.0.1');
}

void bootstrap().catch((error: unknown) => {
  console.error(`Isolated test API failed: ${redactDatabaseUrls(error instanceof Error ? error.message : 'Unknown startup error')}`);
  process.exitCode = 1;
});
