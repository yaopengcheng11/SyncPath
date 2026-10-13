import { ApiProperty } from '@nestjs/swagger';
import { PublicEntry } from '../entries/dto';

export class TimelineActor {
  @ApiProperty() id!: string;
  @ApiProperty() username!: string;
  @ApiProperty({ type: String, nullable: true }) displayName!: string | null;
}

export class TimelineChange {
  @ApiProperty({ enum: ['task', 'card'] }) entity!: 'task' | 'card';
  @ApiProperty() entityId!: string;
  @ApiProperty() title!: string;
  @ApiProperty() field!: string;
  @ApiProperty({ type: String, nullable: true }) before!: string | null;
  @ApiProperty({ type: String, nullable: true }) after!: string | null;
}

export class TimelineProjectSnapshot {
  @ApiProperty() id!: string;
  @ApiProperty() workspaceId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty() startDate!: string;
  @ApiProperty() endDate!: string;
  @ApiProperty({ enum: ['private', 'workspace'] }) visibility!: 'private' | 'workspace';
  @ApiProperty({ enum: ['active', 'archived'] }) status!: 'active' | 'archived';
  @ApiProperty() color!: string;
  @ApiProperty({ type: String, nullable: true }) holidayRegion!: string | null;
  @ApiProperty() revision!: number;
  @ApiProperty({ type: String, nullable: true }) deletedAt!: string | null;
}

export class TimelineSnapshot {
  @ApiProperty({ type: TimelineProjectSnapshot }) project!: TimelineProjectSnapshot;
  @ApiProperty({ type: [PublicEntry] }) entries!: PublicEntry[];
}

export class TimelineVersionSummary {
  @ApiProperty() id!: string;
  @ApiProperty() projectId!: string;
  @ApiProperty() version!: number;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ type: TimelineActor, nullable: true }) actor!: TimelineActor | null;
  @ApiProperty() action!: string;
  @ApiProperty({ type: String, nullable: true }) entryId!: string | null;
  @ApiProperty({ type: [TimelineChange] }) changes!: TimelineChange[];
}

export class TimelineVersionPage {
  @ApiProperty({ type: [TimelineVersionSummary] }) items!: TimelineVersionSummary[];
  @ApiProperty({ type: Number, nullable: true }) nextBeforeVersion!: number | null;
}

export class TimelineVersionDetail extends TimelineVersionSummary {
  @ApiProperty({ type: TimelineSnapshot }) snapshot!: TimelineSnapshot;
}
