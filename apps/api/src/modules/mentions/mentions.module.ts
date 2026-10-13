import { Module } from '@nestjs/common';
import { CollaborationModule } from '../collaboration/collaboration.module';
import { MentionsService } from './mentions.service';
import { MentionCandidatesController, MentionNotificationsController, MentionTimelineController } from './mentions.controller';

@Module({
  imports: [CollaborationModule],
  controllers: [MentionCandidatesController, MentionNotificationsController, MentionTimelineController],
  providers: [MentionsService],
  exports: [MentionsService]
})
export class MentionsModule {}
