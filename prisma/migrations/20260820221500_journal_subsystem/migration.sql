CREATE TYPE "JournalEntryStatus" AS ENUM ('OPEN', 'FINALIZED');
CREATE TYPE "JournalRole" AS ENUM ('REFLECTION', 'USER_DECISION', 'AGENT_OBSERVATION', 'AGENT_HYPOTHESIS', 'AGENT_RECOMMENDATION', 'OBJECTIVE_ACTIVITY');
CREATE TYPE "JournalCandidateKind" AS ENUM ('DECISION', 'REALIZATION', 'MILESTONE', 'DIRECTION_CHANGE', 'ABANDONED_ASSUMPTION', 'IDEA', 'DISAGREEMENT', 'FAILURE', 'CHANGE_OF_MIND', 'COMPLETION', 'EVIDENCE');

CREATE TABLE "JournalEntry" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "entryDate" DATE NOT NULL,
  "title" TEXT NOT NULL,
  "subtitle" TEXT,
  "status" "JournalEntryStatus" NOT NULL DEFAULT 'OPEN',
  "version" INTEGER NOT NULL DEFAULT 1,
  "finalizedAt" TIMESTAMP(3),
  "finalizedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JournalContribution" (
  "id" UUID NOT NULL,
  "entryId" UUID NOT NULL,
  "authorKey" TEXT NOT NULL,
  "authorLabel" TEXT NOT NULL,
  "modelId" TEXT,
  "role" "JournalRole" NOT NULL DEFAULT 'REFLECTION',
  "bodyMarkdown" TEXT NOT NULL,
  "topics" TEXT[] NOT NULL,
  "importance" INTEGER NOT NULL DEFAULT 3,
  "sourceReferences" JSONB,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JournalContribution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JournalContribution_importance_check" CHECK ("importance" BETWEEN 1 AND 5)
);

CREATE TABLE "JournalContributionProject" (
  "contributionId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JournalContributionProject_pkey" PRIMARY KEY ("contributionId", "projectId")
);

CREATE TABLE "JournalContributionRevision" (
  "id" UUID NOT NULL,
  "contributionId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "authorLabel" TEXT NOT NULL,
  "modelId" TEXT,
  "role" "JournalRole" NOT NULL,
  "bodyMarkdown" TEXT NOT NULL,
  "topics" TEXT[] NOT NULL,
  "importance" INTEGER NOT NULL,
  "sourceReferences" JSONB,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JournalContributionRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JournalContributionRevision_importance_check" CHECK ("importance" BETWEEN 1 AND 5)
);

CREATE TABLE "JournalCandidate" (
  "id" UUID NOT NULL,
  "entryId" UUID NOT NULL,
  "projectId" UUID,
  "authorKey" TEXT NOT NULL,
  "authorLabel" TEXT NOT NULL,
  "modelId" TEXT,
  "kind" "JournalCandidateKind" NOT NULL,
  "summary" TEXT NOT NULL,
  "contextMarkdown" TEXT,
  "importance" INTEGER NOT NULL DEFAULT 3,
  "sourceReferences" JSONB,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JournalCandidate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JournalCandidate_importance_check" CHECK ("importance" BETWEEN 1 AND 5)
);

ALTER TABLE "Activity" ADD COLUMN "journalEntryId" UUID;
ALTER TABLE "Activity" ADD COLUMN "journalContributionId" UUID;
ALTER TABLE "Activity" ADD COLUMN "journalCandidateId" UUID;

CREATE UNIQUE INDEX "JournalEntry_workspaceId_entryDate_key" ON "JournalEntry"("workspaceId", "entryDate");
CREATE INDEX "JournalEntry_workspaceId_entryDate_idx" ON "JournalEntry"("workspaceId", "entryDate" DESC);
CREATE UNIQUE INDEX "JournalContribution_entryId_authorKey_key" ON "JournalContribution"("entryId", "authorKey");
CREATE INDEX "JournalContribution_authorKey_updatedAt_idx" ON "JournalContribution"("authorKey", "updatedAt" DESC);
CREATE INDEX "JournalContribution_importance_idx" ON "JournalContribution"("importance");
CREATE INDEX "JournalContribution_search_idx" ON "JournalContribution" USING GIN (to_tsvector('english', coalesce("bodyMarkdown", '') || ' ' || coalesce("authorLabel", '')));
CREATE INDEX "JournalContributionProject_projectId_idx" ON "JournalContributionProject"("projectId");
CREATE UNIQUE INDEX "JournalContributionRevision_contributionId_version_key" ON "JournalContributionRevision"("contributionId", "version");
CREATE INDEX "JournalContributionRevision_contributionId_createdAt_idx" ON "JournalContributionRevision"("contributionId", "createdAt" DESC);
CREATE INDEX "JournalCandidate_entryId_createdAt_idx" ON "JournalCandidate"("entryId", "createdAt");
CREATE INDEX "JournalCandidate_projectId_createdAt_idx" ON "JournalCandidate"("projectId", "createdAt" DESC);
CREATE INDEX "JournalCandidate_authorKey_createdAt_idx" ON "JournalCandidate"("authorKey", "createdAt" DESC);
CREATE INDEX "JournalCandidate_search_idx" ON "JournalCandidate" USING GIN (to_tsvector('english', coalesce("summary", '') || ' ' || coalesce("contextMarkdown", '')));
CREATE INDEX "Activity_journalEntryId_createdAt_idx" ON "Activity"("journalEntryId", "createdAt" DESC);
CREATE INDEX "Activity_journalContributionId_createdAt_idx" ON "Activity"("journalContributionId", "createdAt" DESC);
CREATE INDEX "Activity_journalCandidateId_createdAt_idx" ON "Activity"("journalCandidateId", "createdAt" DESC);

ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JournalContribution" ADD CONSTRAINT "JournalContribution_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JournalContributionProject" ADD CONSTRAINT "JournalContributionProject_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "JournalContribution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JournalContributionProject" ADD CONSTRAINT "JournalContributionProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JournalContributionRevision" ADD CONSTRAINT "JournalContributionRevision_contributionId_fkey" FOREIGN KEY ("contributionId") REFERENCES "JournalContribution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JournalCandidate" ADD CONSTRAINT "JournalCandidate_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JournalCandidate" ADD CONSTRAINT "JournalCandidate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_journalContributionId_fkey" FOREIGN KEY ("journalContributionId") REFERENCES "JournalContribution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_journalCandidateId_fkey" FOREIGN KEY ("journalCandidateId") REFERENCES "JournalCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
