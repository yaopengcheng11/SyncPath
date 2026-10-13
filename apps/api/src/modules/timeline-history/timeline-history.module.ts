import { Module } from '@nestjs/common';
import { TimelineHistoryController } from './timeline-history.controller';
import { TimelineHistoryService } from './timeline-history.service';

@Module({ controllers: [TimelineHistoryController], providers: [TimelineHistoryService], exports: [TimelineHistoryService] })
export class TimelineHistoryModule {}
