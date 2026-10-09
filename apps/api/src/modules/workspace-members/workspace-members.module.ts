import { Module } from '@nestjs/common';
import { WorkspaceMembersController } from './workspace-members.controller';
import { WorkspaceMembersService } from './workspace-members.service';
import { CollaborationModule } from '../collaboration/collaboration.module';

@Module({
  imports: [CollaborationModule],
  controllers: [WorkspaceMembersController],
  providers: [WorkspaceMembersService]
})
export class WorkspaceMembersModule {}
