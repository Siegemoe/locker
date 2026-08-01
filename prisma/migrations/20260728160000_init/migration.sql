CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'MEMBER', 'VIEWER', 'AI_TOOL');
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');
CREATE TYPE "TaskStatus" AS ENUM ('BACKLOG', 'READY', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELED');
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
CREATE TYPE "ActivityActorType" AS ENUM ('USER', 'AI_TOOL', 'SYSTEM');
CREATE TYPE "DependencyType" AS ENUM ('BLOCKS', 'RELATES_TO', 'DUPLICATES');

CREATE TABLE "User" (
  "id" UUID NOT NULL, "externalId" TEXT, "email" TEXT, "displayName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Workspace" (
  "id" UUID NOT NULL, "slug" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3), CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "WorkspaceMember" (
  "workspaceId" UUID NOT NULL, "userId" UUID NOT NULL, "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("workspaceId","userId")
);
CREATE TABLE "Project" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "key" TEXT NOT NULL, "name" TEXT NOT NULL,
  "description" TEXT, "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE', "color" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3), CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Task" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "projectId" UUID, "title" TEXT NOT NULL,
  "description" TEXT, "status" "TaskStatus" NOT NULL DEFAULT 'BACKLOG',
  "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM', "position" INTEGER NOT NULL DEFAULT 0,
  "dueAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), "approvedAt" TIMESTAMP(3),
  "approvedBy" TEXT, "createdBy" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, "archivedAt" TIMESTAMP(3),
  CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "TaskDependency" (
  "taskId" UUID NOT NULL, "dependsOnId" UUID NOT NULL,
  "type" "DependencyType" NOT NULL DEFAULT 'BLOCKS',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("taskId","dependsOnId","type"),
  CONSTRAINT "TaskDependency_no_self" CHECK ("taskId" <> "dependsOnId")
);
CREATE TABLE "Activity" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "projectId" UUID, "taskId" UUID,
  "actorUserId" UUID, "actorType" "ActivityActorType" NOT NULL, "actorLabel" TEXT NOT NULL,
  "action" TEXT NOT NULL, "summary" TEXT NOT NULL, "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_externalId_key" ON "User"("externalId");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");
CREATE UNIQUE INDEX "Project_workspaceId_key_key" ON "Project"("workspaceId","key");
CREATE INDEX "Project_workspaceId_status_idx" ON "Project"("workspaceId","status");
CREATE INDEX "Task_workspaceId_status_position_idx" ON "Task"("workspaceId","status","position");
CREATE INDEX "Task_projectId_status_position_idx" ON "Task"("projectId","status","position");
CREATE INDEX "Task_dueAt_idx" ON "Task"("dueAt");
CREATE INDEX "TaskDependency_dependsOnId_idx" ON "TaskDependency"("dependsOnId");
CREATE INDEX "Activity_workspaceId_createdAt_idx" ON "Activity"("workspaceId","createdAt" DESC);
CREATE INDEX "Activity_taskId_createdAt_idx" ON "Activity"("taskId","createdAt" DESC);

ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
