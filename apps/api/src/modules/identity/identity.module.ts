import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { SessionsService } from './sessions.service';
import { SessionsController } from './sessions.controller';
import { SessionAuthGuard } from './session-auth.guard';

@Module({
  controllers: [SessionsController],
  providers: [UsersService, SessionsService, SessionAuthGuard],
  exports: [UsersService, SessionsService, SessionAuthGuard]
})
export class IdentityModule {}
