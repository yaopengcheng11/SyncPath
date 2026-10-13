import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { ProjectByIdController } from './project-by-id.controller';
import { TimelineHistoryModule } from '../timeline-history/timeline-history.module';

@Module({
  imports: [TimelineHistoryModule],
  controllers: [ProjectsController, ProjectByIdController],
  providers: [ProjectsService],
  exports: [ProjectsService]
})
export class ProjectsModule {}
