import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './common/prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { SessionAuthGuard } from './modules/identity/session-auth.guard';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { EntriesModule } from './modules/entries/entries.module';
import { ImportsModule } from './modules/imports/imports.module';
import { ProjectMembersModule } from './modules/project-members/project-members.module';
import { WorkspaceMembersModule } from './modules/workspace-members/workspace-members.module';
import { CollaborationModule } from './modules/collaboration/collaboration.module';
import { MentionsModule } from './modules/mentions/mentions.module';
import { SharingModule } from './modules/sharing/sharing.module';
import {
  ProjectRolesGuard,
  WorkspaceRolesGuard
} from './common/rbac/guards';

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    IdentityModule,
    WorkspacesModule,
    ProjectsModule,
    EntriesModule,
    ImportsModule,
    ProjectMembersModule,
    WorkspaceMembersModule,
    CollaborationModule,
    MentionsModule,
    SharingModule
  ],
  providers: [
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    WorkspaceRolesGuard,
    ProjectRolesGuard
  ]
})
export class AppModule {}
