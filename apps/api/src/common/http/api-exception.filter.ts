import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

interface ErrorEnvelope {
  statusCode: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId?: string;
}

const STATUS_TO_CODE: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'unprocessable_entity',
  429: 'rate_limited'
};

/**
 * Translate any NestJS-thrown exception into the standard SyncPath error
 * envelope { statusCode, code, message, details, requestId }. The `code`
 * field is taken from the exception body when present, otherwise from the
 * status code.
 *
 * Source of truth: docs §6.1 ("错误携带稳定 code、message、requestId 和
 * 可公开的字段详情").
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<FastifyRequest>();
    const reply = ctx.getResponse<FastifyReply>();
    const requestId =
      (req.headers['x-request-id'] as string | undefined) ?? undefined;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let payload: ErrorEnvelope = {
      statusCode: status,
      code: 'internal_error',
      message: 'Internal server error.',
      requestId
    };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        payload = {
          statusCode: status,
          code: STATUS_TO_CODE[status] ?? 'error',
          message: body,
          requestId
        };
      } else if (body && typeof body === 'object') {
        const obj = body as Record<string, unknown>;
        const message = (obj.message as unknown) ?? exception.message;
        const messageText = Array.isArray(message)
          ? message.join('; ')
          : typeof message === 'string'
            ? message
            : exception.message;
        payload = {
          statusCode: status,
          code:
            (obj.code as string | undefined) ??
            STATUS_TO_CODE[status] ??
            'error',
          message: messageText,
          details: (obj.details as Record<string, unknown> | undefined),
          requestId
        };
      }
    } else if (exception instanceof Error) {
      this.logger.error(
        `Unhandled error (${exception.name}): ${exception.message}`,
        exception.stack
      );
    } else {
      this.logger.error(`Unhandled throw: ${String(exception)}`);
    }

    reply.status(status).send(payload);
  }
}
