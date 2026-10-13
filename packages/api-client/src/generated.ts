export interface paths {
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Liveness + database ping
         * @description Returns service uptime and database connectivity status.
         */
        get: operations["HealthController_check"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/sessions/register": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Register a new account and start a session.
         * @description POST /api/v1/sessions/register — create a new account and start a session.
         */
        post: operations["SessionsController_register"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Log in with username or email + password.
         * @description POST /api/v1/sessions — log in with username (or email) + password.
         */
        post: operations["SessionsController_login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/sessions/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Return the currently authenticated user.
         * @description GET /api/v1/sessions/me — return the current user (used by the SPA on load).
         */
        get: operations["SessionsController_me"];
        put?: never;
        post?: never;
        /**
         * Revoke the current session and clear the cookie.
         * @description DELETE /api/v1/sessions/me — revoke the session and clear the cookie.
         */
        delete: operations["SessionsController_logout"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workspaces": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List workspaces the caller is a member of. */
        get: operations["WorkspacesController_list"];
        put?: never;
        /** Create a workspace. The caller becomes Owner. */
        post: operations["WorkspacesController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workspaces/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Fetch a single workspace by id. */
        get: operations["WorkspacesController_getOne"];
        put?: never;
        post?: never;
        /** Permanently delete a workspace and its children (Owner only). */
        delete: operations["WorkspacesController_remove"];
        options?: never;
        head?: never;
        /** Rename a workspace (Owner/Admin). */
        patch: operations["WorkspacesController_update"];
        trace?: never;
    };
    "/api/v1/workspaces/{workspaceId}/projects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List projects in a workspace the caller can see. */
        get: operations["ProjectsController_list"];
        put?: never;
        /** Create a project. The caller becomes Lead. */
        post: operations["ProjectsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workspaces/{workspaceId}/projects/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Fetch a project by id within the workspace. */
        get: operations["ProjectsController_getOne"];
        put?: never;
        post?: never;
        /** Permanently delete a project and its children within the workspace. */
        delete: operations["ProjectsController_remove"];
        options?: never;
        head?: never;
        /** Update a project within the workspace. */
        patch: operations["ProjectsController_update"];
        trace?: never;
    };
    "/api/v1/projects/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Fetch a project by id. */
        get: operations["ProjectByIdController_getOne"];
        put?: never;
        post?: never;
        /** Permanently delete a project and its children (Lead only). */
        delete: operations["ProjectByIdController_remove"];
        options?: never;
        head?: never;
        /** Update a project (revision-checked via expectedRevision). */
        patch: operations["ProjectByIdController_update"];
        trace?: never;
    };
    "/api/v1/projects/{projectId}/timeline-versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List immutable timeline versions (task Lead or project administrator only). */
        get: operations["TimelineHistoryController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{projectId}/timeline-versions/{versionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Inspect a historical timeline snapshot and its field changes. */
        get: operations["TimelineHistoryController_detail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{projectId}/entries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List progress entries for a project (optional ?from & ?to). */
        get: operations["ProjectEntriesController_list"];
        put?: never;
        /** Create a progress entry. */
        post: operations["ProjectEntriesController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/entries/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Fetch a progress entry by id. */
        get: operations["EntryActionsController_getOne"];
        put?: never;
        post?: never;
        /** Permanently delete a progress entry and its history content (revision-checked via expectedRevision). */
        delete: operations["EntryActionsController_remove"];
        options?: never;
        head?: never;
        /** Update a progress entry (revision-checked via expectedRevision). */
        patch: operations["EntryActionsController_update"];
        trace?: never;
    };
    "/api/v1/projects/{projectId}/mention-candidates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List users eligible to be mentioned in this project. */
        get: operations["MentionCandidatesController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List mentions addressed to the signed-in user. */
        get: operations["MentionNotificationsController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications/{id}/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Mark one of the signed-in user’s mentions as read. */
        patch: operations["MentionNotificationsController_markRead"];
        trace?: never;
    };
    "/api/v1/mentions/timeline": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Combine the signed-in user’s currently accessible mentioned cards on one timeline. */
        get: operations["MentionTimelineController_timeline"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/imports/validate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Pre-flight check for a legacy JSON import. Never writes. */
        post: operations["ImportsController_validate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/imports/apply": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Apply a legacy JSON import (requires accept: true). */
        post: operations["ImportsController_apply"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{projectId}/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List project members (Lead/Editor/Viewer). */
        get: operations["ProjectMembersController_list"];
        put?: never;
        /** Invite a user to this project (Lead only). */
        post: operations["ProjectMembersController_invite"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{projectId}/members/{userId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove a member from this project (Lead only). */
        delete: operations["ProjectMembersController_remove"];
        options?: never;
        head?: never;
        /** Change a member’s role (Lead only). */
        patch: operations["ProjectMembersController_changeRole"];
        trace?: never;
    };
    "/api/v1/workspaces/{workspaceId}/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List workspace members. */
        get: operations["WorkspaceMembersController_list"];
        put?: never;
        /** Invite a workspace member. */
        post: operations["WorkspaceMembersController_invite"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workspaces/{workspaceId}/members/{userId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove a workspace member. */
        delete: operations["WorkspaceMembersController_remove"];
        options?: never;
        head?: never;
        /** Change a workspace member role. */
        patch: operations["WorkspaceMembersController_changeRole"];
        trace?: never;
    };
    "/api/v1/workspaces/{workspaceId}/share-links": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List workspace share metadata; raw tokens are never returned. */
        get: operations["SharingController_listWorkspace"];
        put?: never;
        /** Create a read-only share link for a workspace (administrator only). */
        post: operations["SharingController_createWorkspace"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/projects/{projectId}/share-links": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List project share metadata; raw tokens are never returned. */
        get: operations["SharingController_listProject"];
        put?: never;
        /** Create a read-only share link for one project (Lead or workspace administrator). */
        post: operations["SharingController_createProject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/share-links/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Revoke a link using current management permission on its actual target. */
        delete: operations["SharingController_revoke"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/share-links/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Resolve shared read-only content after authentication; token is sent in the body. */
        post: operations["SharingController_resolve"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/received-shares": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List shares previously opened by the authenticated recipient, including unavailable snapshots. */
        get: operations["SharingController_listReceived"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/received-shares/{id}/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reopen a recipient-owned receipt after rechecking the original share link. */
        post: operations["SharingController_resolveReceived"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Function: Record<string, never>;
        PublicUser: {
            /** Format: uuid */
            id: string;
            /** @example alice */
            username: string;
            /** @example alice@syncpath.local */
            email: string;
            /** @example Alice Wong */
            displayName: string | null;
            /** @example 2026-09-16T10:34:55.612Z */
            createdAt: string;
        };
        SessionResponse: {
            user: components["schemas"]["PublicUser"];
            /** @example 2026-10-16T10:39:46.279Z */
            expiresAt: string;
        };
        PublicWorkspace: {
            /** Format: uuid */
            id: string;
            /** @example R1 Pilot */
            name: string;
            /** @example r1-pilot */
            slug: string;
            /** @enum {string} */
            role: "Owner" | "Admin" | "Member";
            /** @example 2026-09-16T10:35:05.852Z */
            createdAt: string;
        };
        PublicProject: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            workspaceId: string;
            name: string;
            description: string | null;
            /** @example 2026-01-05 */
            startDate: string;
            /** @example 2026-03-29 */
            endDate: string;
            /** @enum {string} */
            visibility: "private" | "workspace";
            /** @enum {string} */
            status: "active" | "archived";
            /** @example #6366f1 */
            color: string;
            /** @enum {string|null} */
            holidayRegion: "CN" | "US" | "NONE" | null;
            revision: number;
            /** Format: uuid */
            creatorId: string;
            /** @example 2026-09-16T10:49:08.341Z */
            createdAt: string;
            /** @example 2026-09-16T10:49:08.341Z */
            updatedAt: string;
            /**
             * @description Caller's role in this project; null if not a member.
             * @enum {string|null}
             */
            myRole: "Lead" | "Editor" | "Viewer" | null;
        };
        CreateProjectBody: {
            /** @example R1 Pilot — G1 cohort */
            name: string;
            description?: string | null;
            /** @example 2026-01-05 */
            startDate: string;
            /** @example 2026-03-29 */
            endDate: string;
            /**
             * @example workspace
             * @enum {string}
             */
            visibility?: "private" | "workspace";
            /** @example #10b981 */
            color?: string;
            /**
             * @example CN
             * @enum {string}
             */
            holidayRegion?: "CN" | "US" | "NONE";
        };
        UpdateProjectBody: {
            name?: string;
            description?: string | null;
            /** @example 2026-01-05 */
            startDate?: string;
            /** @example 2026-03-29 */
            endDate?: string;
            /** @enum {string} */
            visibility?: "private" | "workspace";
            /** @enum {string} */
            status?: "active";
            /** @example #6366f1 */
            color?: string;
            /** @enum {string} */
            holidayRegion?: "CN" | "US" | "NONE";
            /** @description Optimistic-lock revision. */
            expectedRevision: number;
        };
        TimelineActor: {
            id: string;
            username: string;
            displayName: string | null;
        };
        TimelineChange: {
            /** @enum {string} */
            entity: "task" | "card";
            entityId: string;
            title: string;
            field: string;
            before: string | null;
            after: string | null;
        };
        TimelineVersionSummary: {
            id: string;
            projectId: string;
            version: number;
            createdAt: string;
            actor: components["schemas"]["TimelineActor"] | null;
            action: string;
            entryId: string | null;
            changes: components["schemas"]["TimelineChange"][];
        };
        TimelineVersionPage: {
            items: components["schemas"]["TimelineVersionSummary"][];
            nextBeforeVersion: number | null;
        };
        TimelineProjectSnapshot: {
            id: string;
            workspaceId: string;
            name: string;
            description: string | null;
            startDate: string;
            endDate: string;
            /** @enum {string} */
            visibility: "private" | "workspace";
            /** @enum {string} */
            status: "active" | "archived";
            color: string;
            holidayRegion: string | null;
            revision: number;
            deletedAt: string | null;
        };
        PublicEntry: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            projectId: string;
            /** @example 2026-01-12 */
            weekStartDate: string;
            /** Format: uuid */
            authorId: string;
            title: string;
            /** @enum {string} */
            level: "primary" | "secondary" | "minor";
            summary: string | null;
            notes: string | null;
            mentionAll: boolean;
            mentionedUserIds: string[];
            /** @enum {string} */
            status: "pending" | "completed";
            /** @description Locked cards cannot be moved, edited, or deleted. */
            isLocked: boolean;
            revision: number;
            /** @example 2026-09-16T10:49:09.010Z */
            createdAt: string;
            /** @example 2026-09-16T10:49:09.010Z */
            updatedAt: string;
        };
        TimelineSnapshot: {
            project: components["schemas"]["TimelineProjectSnapshot"];
            entries: components["schemas"]["PublicEntry"][];
        };
        TimelineVersionDetail: {
            id: string;
            projectId: string;
            version: number;
            createdAt: string;
            actor: components["schemas"]["TimelineActor"] | null;
            action: string;
            entryId: string | null;
            changes: components["schemas"]["TimelineChange"][];
            snapshot: components["schemas"]["TimelineSnapshot"];
        };
        CreateEntryBody: {
            /**
             * @description YYYY-MM-DD; the server normalises to Monday-aligned week start.
             * @example 2026-01-12
             */
            weekStartDate: string;
            /**
             * @description Legacy terminology: WorkLog.author stored the *title*.
             * @example Spec draft
             */
            title: string;
            /** @enum {string} */
            level: "primary" | "secondary" | "minor";
            summary?: string | null;
            notes?: string | null;
            /** @description Mention every eligible project member. */
            mentionAll?: boolean;
            /** @description Explicit project member IDs to mention. */
            mentionedUserIds?: string[];
            /** @enum {string} */
            status?: "pending" | "completed";
        };
        UpdateEntryBody: {
            /** @description YYYY-MM-DD week start date. */
            weekStartDate?: string;
            title?: string;
            /** @enum {string} */
            level?: "primary" | "secondary" | "minor";
            summary?: string | null;
            notes?: string | null;
            mentionAll?: boolean;
            mentionedUserIds?: string[];
            /** @enum {string} */
            status?: "pending" | "completed";
            /** @description Toggle the lock. The only field a locked card accepts; every other change is rejected while the lock is set. */
            isLocked?: boolean;
            /** @description Optimistic-lock revision. */
            expectedRevision: number;
        };
        MentionCandidateResponse: {
            id: string;
            username: string;
            displayName: string | null;
        };
        MentionProjectResponse: {
            id: string;
            name: string;
        };
        MentionEntryResponse: {
            id: string;
            title: string;
            date: string;
        };
        MentionNotificationResponse: {
            id: string;
            workspaceId: string;
            project: components["schemas"]["MentionProjectResponse"];
            entry: components["schemas"]["MentionEntryResponse"];
            actor: components["schemas"]["MentionCandidateResponse"];
            createdAt: string;
            readAt: string | null;
        };
        MentionTimelineWorkspace: {
            id: string;
            name: string;
        };
        MentionTimelineItem: {
            workspace: components["schemas"]["MentionTimelineWorkspace"];
            project: components["schemas"]["PublicProject"];
            entry: components["schemas"]["PublicEntry"];
        };
        MentionTimelineContent: {
            workspaces: components["schemas"]["MentionTimelineWorkspace"][];
            items: components["schemas"]["MentionTimelineItem"][];
        };
        InviteMemberBody: {
            /** Format: uuid */
            userId?: string;
            /**
             * @description Username or email. Used when userId is not supplied.
             * @example alex@company.com
             */
            identifier?: string;
            /** @enum {string} */
            role: "Lead" | "Editor" | "Viewer";
        };
        ChangeRoleBody: {
            /** @enum {string} */
            role: "Lead" | "Editor" | "Viewer";
        };
        InviteWorkspaceMemberBody: {
            /** Format: uuid */
            userId?: string;
            /** @example alex@company.com */
            identifier?: string;
            /** @enum {string} */
            role: "Owner" | "Admin" | "Member";
        };
        ChangeWorkspaceRoleBody: {
            /** @enum {string} */
            role: "Owner" | "Admin" | "Member";
        };
        CreatedShareLink: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            kind: "workspace" | "project";
            createdAt: string;
            revokedAt: string | null;
            /** @description Opaque capability returned only once; place it in the URL fragment. */
            token: string;
        };
        PublicShareLink: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            kind: "workspace" | "project";
            createdAt: string;
            revokedAt: string | null;
        };
        ResolveShareLinkBody: {
            /** @description Opaque token from the shared URL fragment. */
            token: string;
        };
        SharedWorkspace: {
            /** Format: uuid */
            id: string;
            name: string;
        };
        SharedContent: {
            /** @enum {string} */
            kind: "workspace" | "project";
            workspace: components["schemas"]["SharedWorkspace"];
            projects: components["schemas"]["PublicProject"][];
            entries: components["schemas"]["PublicEntry"][];
        };
        ReceivedShareSharer: {
            username: string;
            displayName: string | null;
        };
        ReceivedShare: {
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            kind: "workspace" | "project";
            name: string;
            workspaceName: string;
            sharedBy: components["schemas"]["ReceivedShareSharer"];
            receivedAt: string;
            /** @enum {string} */
            status: "active" | "unavailable";
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    HealthController_check: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    SessionsController_register: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Function"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionResponse"];
                };
            };
        };
    };
    SessionsController_login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Function"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionResponse"];
                };
            };
        };
    };
    SessionsController_me: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionResponse"];
                };
            };
        };
    };
    SessionsController_logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    WorkspacesController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicWorkspace"][];
                };
            };
        };
    };
    WorkspacesController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Function"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicWorkspace"];
                };
            };
        };
    };
    WorkspacesController_getOne: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicWorkspace"];
                };
            };
        };
    };
    WorkspacesController_remove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    WorkspacesController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Function"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicWorkspace"];
                };
            };
        };
    };
    ProjectsController_list: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicProject"][];
                };
            };
        };
    };
    ProjectsController_create: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateProjectBody"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicProject"];
                };
            };
        };
    };
    ProjectsController_getOne: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicProject"];
                };
            };
        };
    };
    ProjectsController_remove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ProjectsController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateProjectBody"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicProject"];
                };
            };
        };
    };
    ProjectByIdController_getOne: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicProject"];
                };
            };
        };
    };
    ProjectByIdController_remove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ProjectByIdController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateProjectBody"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicProject"];
                };
            };
        };
    };
    TimelineHistoryController_list: {
        parameters: {
            query?: {
                beforeVersion?: number;
                limit?: number;
            };
            header: {
                "x-syncpath-user-id": string;
                "X-SyncPath-User-Id"?: string;
            };
            path: {
                projectId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TimelineVersionPage"];
                };
            };
        };
    };
    TimelineHistoryController_detail: {
        parameters: {
            query?: never;
            header: {
                "x-syncpath-user-id": string;
                "X-SyncPath-User-Id"?: string;
            };
            path: {
                projectId: string;
                versionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TimelineVersionDetail"];
                };
            };
        };
    };
    ProjectEntriesController_list: {
        parameters: {
            query: {
                from: string;
                to: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicEntry"][];
                };
            };
        };
    };
    ProjectEntriesController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateEntryBody"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicEntry"];
                };
            };
        };
    };
    EntryActionsController_getOne: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicEntry"];
                };
            };
        };
    };
    EntryActionsController_remove: {
        parameters: {
            query?: {
                /** @description Optimistic-lock revision of the card the caller last saw. */
                expectedRevision?: string;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    EntryActionsController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateEntryBody"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicEntry"];
                };
            };
        };
    };
    MentionCandidatesController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MentionCandidateResponse"][];
                };
            };
        };
    };
    MentionNotificationsController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MentionNotificationResponse"][];
                };
            };
        };
    };
    MentionNotificationsController_markRead: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    MentionTimelineController_timeline: {
        parameters: {
            query?: {
                /** @description Comma separated project IDs; omitted means all projects, empty means none. */
                workspaceIds?: string;
            };
            header: {
                "x-syncpath-user-id": string;
                "X-SyncPath-User-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MentionTimelineContent"];
                };
            };
        };
    };
    ImportsController_validate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ImportsController_apply: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    ProjectMembersController_list: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>[];
                };
            };
        };
    };
    ProjectMembersController_invite: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InviteMemberBody"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ProjectMembersController_remove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                userId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    ProjectMembersController_changeRole: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                userId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChangeRoleBody"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    WorkspaceMembersController_list: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": Record<string, never>[];
                };
            };
        };
    };
    WorkspaceMembersController_invite: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["InviteWorkspaceMemberBody"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    WorkspaceMembersController_remove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                userId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    WorkspaceMembersController_changeRole: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
                userId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChangeWorkspaceRoleBody"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SharingController_listWorkspace: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicShareLink"][];
                };
            };
        };
    };
    SharingController_createWorkspace: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                workspaceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatedShareLink"];
                };
            };
        };
    };
    SharingController_listProject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicShareLink"][];
                };
            };
        };
    };
    SharingController_createProject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatedShareLink"];
                };
            };
        };
    };
    SharingController_revoke: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    SharingController_resolve: {
        parameters: {
            query?: never;
            header: {
                "x-syncpath-user-id": string;
                /** @description Expected authenticated user ID; rejects a session changed by another browser tab. */
                "X-SyncPath-User-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ResolveShareLinkBody"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SharedContent"];
                };
            };
        };
    };
    SharingController_listReceived: {
        parameters: {
            query?: never;
            header: {
                "x-syncpath-user-id": string;
                /** @description Expected authenticated user ID; rejects a session changed by another browser tab. */
                "X-SyncPath-User-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReceivedShare"][];
                };
            };
        };
    };
    SharingController_resolveReceived: {
        parameters: {
            query?: never;
            header: {
                "x-syncpath-user-id": string;
                /** @description Expected authenticated user ID; rejects a session changed by another browser tab. */
                "X-SyncPath-User-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SharedContent"];
                };
            };
        };
    };
}
