import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException
} from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { hashPassword, verifyPassword } from '../../common/crypto/passwords';
import { newUserId } from '@syncpath/domain';
import type { PublicUser, RegisterBody } from './dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async register(input: RegisterBody): Promise<User> {
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: input.email }, { username: input.username }]
      }
    });
    if (existing) {
      // Distinguish email-vs-username only when asked; for R0 we keep the
      // message generic so we don't leak account existence.
      throw new ConflictException({
        code: 'user_already_exists',
        message: 'An account with the same email or username already exists.'
      });
    }
    const passwordHash = await hashPassword(input.password);
    return this.prisma.user.create({
      data: {
        id: newUserId(),
        email: input.email,
        username: input.username,
        displayName: input.displayName ?? null,
        passwordHash
      }
    });
  }

  async authenticate(
    usernameOrEmail: string,
    password: string
  ): Promise<User> {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ username: usernameOrEmail }, { email: usernameOrEmail }]
      }
    });
    if (!user || user.status !== 'active') {
      // Same message for unknown user and bad password.
      throw new UnauthorizedException({
        code: 'invalid_credentials',
        message: 'Invalid username or password.'
      });
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException({
        code: 'invalid_credentials',
        message: 'Invalid username or password.'
      });
    }
    return user;
  }

  async findById(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException({
        code: 'user_not_found',
        message: 'User not found.'
      });
    }
    return user;
  }

  toPublic(user: User): PublicUser {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt.toISOString()
    };
  }
}
