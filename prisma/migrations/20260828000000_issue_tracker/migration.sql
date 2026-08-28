CREATE TYPE "IssueKind" AS ENUM ('BUG', 'REGRESSION', 'DEBT');
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'TRIAGED', 'RESOLVED', 'CLOSED');
CREATE TYPE "IssueSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "IssueCloseReason" AS ENUM ('FIXED', 'WONT_FIX', 'DUPLICATE', 'NOT_A_BUG');

CREATE TABLE "Issue" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "kind" "IssueKind" NOT NULL DEFAULT 'BUG',
  "title" TEXT NOT NULL,
  "details" TEXT,
  "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
  "severity" "IssueSeverity" NOT NULL DEFAULT 'MEDIUM',
  "closeReason" "IssueCloseReason",
  "projectId" UUID NOT NULL,
  "assignedTaskId" UUID,
  "duplicateOfId" UUID,
  "sourceCandidateId" UUID,
  "reportedBy" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "resolvedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Artifact" ALTER COLUMN "taskId" DROP NOT NULL;
ALTER TABLE "Artifact" ADD COLUMN "issueId" UUID;
ALTER TABLE "Activity" ADD COLUMN "issueId" UUID;

CREATE UNIQUE INDEX "Issue_workspaceId_code_key" ON "Issue"("workspaceId", "code");
CREATE INDEX "Issue_workspaceId_status_severity_idx" ON "Issue"("workspaceId", "status", "severity");
CREATE INDEX "Issue_projectId_status_idx" ON "Issue"("projectId", "status");
CREATE INDEX "Issue_assignedTaskId_idx" ON "Issue"("assignedTaskId");
CREATE INDEX "Issue_sourceCandidateId_idx" ON "Issue"("sourceCandidateId");
CREATE INDEX "Issue_duplicateOfId_idx" ON "Issue"("duplicateOfId");
CREATE INDEX "Artifact_issueId_archivedAt_idx" ON "Artifact"("issueId", "archivedAt");
CREATE INDEX "Activity_issueId_createdAt_idx" ON "Activity"("issueId", "createdAt" DESC);

ALTER TABLE "Issue" ADD CONSTRAINT "Issue_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_assignedTaskId_fkey" FOREIGN KEY ("assignedTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_sourceCandidateId_fkey" FOREIGN KEY ("sourceCandidateId") REFERENCES "JournalCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_owner_check" CHECK (("taskId" IS NOT NULL)::integer + ("issueId" IS NOT NULL)::integer = 1);

-- Existing workspaces get the default bucket for issues without a project.
INSERT INTO "Project" ("id", "workspaceId", "key", "name", "updatedAt")
SELECT gen_random_uuid(), w."id", 'UNASSIGNED', 'Unassigned', CURRENT_TIMESTAMP
FROM "Workspace" w
ON CONFLICT ("workspaceId", "key") DO NOTHING;
