import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Req,
  Res
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { UsersService } from './users.service';
import { SessionsService } from './sessions.service';
import { CurrentUser } from './current-user.decorator';
import { Public } from './public.decorator';
import type { User } from '@prisma/client';
import {
  clearSessionCookie,
  readSessionCookieOptions,
  readSessionToken,
  setSessionCookie
} from '../../common/session/session';
import type {
  LoginBody,
  RegisterBody,
  SessionResponse
} from './dto';

@ApiTags('identity')
@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionsService
  ) {}

  /** POST /api/v1/sessions/register — create a new account and start a session. */
  @Public()
  @ApiOperation({ summary: 'Register a new account and start a session.' })
  @Post('register')
  async register(
    @Body() body: RegisterBody,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<SessionResponse> {
    const errors = validateRegister(body);
    if (errors) {
      throw new Error(errors); // surface to global filter
    }
    const user = await this.users.register(body);
    return this.startSession(user, req, reply);
  }

  /** POST /api/v1/sessions — log in with username (or email) + password. */
  @Public()
  @ApiOperation({ summary: 'Log in with username or email + password.' })
  @Post()
  @HttpCode(200)
  async login(
    @Body() body: LoginBody,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<SessionResponse> {
    if (!body || !body.username || !body.password) {
      reply.code(422);
      throw new Error('Missing username or password');
    }
    const user = await this.users.authenticate(body.username, body.password);
    return this.startSession(user, req, reply);
  }

  /** GET /api/v1/sessions/me — return the current user (used by the SPA on load). */
  @ApiOperation({ summary: 'Return the currently authenticated user.' })
  @Get('me')
  async me(
    @CurrentUser() user: User,
    @Req() req: FastifyRequest
  ): Promise<SessionResponse> {
    const session = req.session!;
    return {
      user: this.users.toPublic(user),
      expiresAt: session.expiresAt.toISOString()
    };
  }

  /** DELETE /api/v1/sessions/me — revoke the session and clear the cookie. */
  @ApiOperation({ summary: 'Revoke the current session and clear the cookie.' })
  @Delete('me')
  async logout(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<{ ok: true }> {
    const opts = readSessionCookieOptions();
    const token = readSessionToken(req, opts.name);
    await this.sessions.revoke(token);
    clearSessionCookie(reply, opts.name);
    return { ok: true };
  }

  // ─── helpers ────────────────────────────────────────────────────────────

  private async startSession(
    user: User,
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<SessionResponse> {
    const userAgent = req.headers['user-agent'] ?? undefined;
    const ipAddress = req.ip ?? undefined;
    const { session, token } = await this.sessions.create(user, {
      userAgent,
      ipAddress
    });
    const opts = readSessionCookieOptions();
    setSessionCookie(reply, token, opts);
    return {
      user: this.users.toPublic(user),
      expiresAt: session.expiresAt.toISOString()
    };
  }
}

function validateRegister(body: RegisterBody | undefined): string | null {
  if (!body) return 'Missing request body';
  if (!body.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) {
    return 'Invalid email';
  }
  if (!body.username || !/^[a-zA-Z0-9_-]{3,32}$/.test(body.username)) {
    return 'Username must be 3–32 chars (letters, digits, _ or -)';
  }
  if (!body.password || body.password.length < 8) {
    return 'Password must be at least 8 characters';
  }
  return null;
}
