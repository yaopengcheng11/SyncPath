import { ApiProperty } from '@nestjs/swagger';

/**
 * Identity module DTOs.
 *
 * These are hand-rolled rather than generated from class-validator
 * decorators in this iteration — we mirror the shape we expose in the
 * OpenAPI schema (DEV-006). Validation lives in the controllers for now.
 */

export class RegisterBody {
  @ApiProperty({ example: 'alice@syncpath.local' })
  email!: string;

  @ApiProperty({ example: 'alice', minLength: 3, maxLength: 32 })
  username!: string;

  @ApiProperty({ minLength: 8, format: 'password' })
  password!: string;

  @ApiProperty({ required: false, nullable: true, example: 'Alice Wong' })
  displayName?: string;
}

export class LoginBody {
  @ApiProperty({ example: 'alice' })
  username!: string;

  @ApiProperty({ format: 'password' })
  password!: string;
}

export class PublicUser {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'alice' })
  username!: string;

  @ApiProperty({ example: 'alice@syncpath.local' })
  email!: string;

  @ApiProperty({ nullable: true, example: 'Alice Wong' })
  displayName!: string | null;

  @ApiProperty({ example: '2026-09-16T10:34:55.612Z' })
  createdAt!: string;
}

export class SessionResponse {
  @ApiProperty({ type: () => PublicUser })
  user!: PublicUser;

  @ApiProperty({ example: '2026-10-16T10:39:46.279Z' })
  expiresAt!: string;
}

export class ApiErrorBody {
  @ApiProperty({ example: 401 })
  statusCode!: number;

  @ApiProperty({ example: 'no_session' })
  code!: string;

  @ApiProperty({ example: 'Authentication required.' })
  message!: string;

  @ApiProperty({
    required: false,
    nullable: true,
    type: 'object',
    additionalProperties: true,
    example: { field: 'email', reason: 'invalid' }
  })
  details?: Record<string, unknown>;

  @ApiProperty({ required: false, nullable: true, example: 'req_abc123' })
  requestId?: string;
}
