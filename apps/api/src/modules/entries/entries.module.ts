import { Module } from '@nestjs/common';
import { EntriesService } from './entries.service';
import { CollaborationModule } from '../collaboration/collaboration.module';
import { MentionsModule } from '../mentions/mentions.module';
import {
  ProjectEntriesController,
  EntryActionsController
} from './entries.controller';

@Module({
  imports: [CollaborationModule, MentionsModule],
  controllers: [ProjectEntriesController, EntryActionsController],
  providers: [EntriesService],
  exports: [EntriesService]
})
export class EntriesModule {}
