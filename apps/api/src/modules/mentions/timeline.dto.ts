import { ApiProperty } from '@nestjs/swagger';
import { PublicEntry } from '../entries/dto';
import { PublicProject } from '../projects/dto';

export class MentionTimelineWorkspace {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}
export class MentionTimelineItem {
  @ApiProperty({ type: MentionTimelineWorkspace }) workspace!: MentionTimelineWorkspace;
  @ApiProperty({ type: PublicProject }) project!: PublicProject;
  @ApiProperty({ type: PublicEntry }) entry!: PublicEntry;
}
export class MentionTimelineContent {
  @ApiProperty({ type: [MentionTimelineWorkspace] }) workspaces!: MentionTimelineWorkspace[];
  @ApiProperty({ type: [MentionTimelineItem] }) items!: MentionTimelineItem[];
}
