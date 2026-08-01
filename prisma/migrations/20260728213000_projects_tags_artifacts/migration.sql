CREATE TYPE "ArtifactKind" AS ENUM ('LINK', 'TEXT', 'FILE_METADATA');

CREATE TABLE "Tag" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "name" TEXT NOT NULL, "color" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3), CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "TaskTag" (
  "taskId" UUID NOT NULL, "tagId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskTag_pkey" PRIMARY KEY ("taskId","tagId")
);
CREATE TABLE "Artifact" (
  "id" UUID NOT NULL, "workspaceId" UUID NOT NULL, "taskId" UUID NOT NULL,
  "kind" "ArtifactKind" NOT NULL, "title" TEXT NOT NULL, "url" TEXT, "textContent" TEXT,
  "fileName" TEXT, "mimeType" TEXT, "sizeBytes" INTEGER, "storageKey" TEXT, "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3), CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Activity" ADD COLUMN "tagId" UUID;
ALTER TABLE "Activity" ADD COLUMN "artifactId" UUID;

CREATE UNIQUE INDEX "Tag_workspaceId_name_key" ON "Tag"("workspaceId","name");
CREATE INDEX "Tag_workspaceId_archivedAt_idx" ON "Tag"("workspaceId","archivedAt");
CREATE INDEX "TaskTag_tagId_idx" ON "TaskTag"("tagId");
CREATE INDEX "Artifact_taskId_archivedAt_idx" ON "Artifact"("taskId","archivedAt");
CREATE INDEX "Artifact_workspaceId_createdAt_idx" ON "Artifact"("workspaceId","createdAt" DESC);
CREATE INDEX "Activity_tagId_createdAt_idx" ON "Activity"("tagId","createdAt" DESC);
CREATE INDEX "Activity_artifactId_createdAt_idx" ON "Activity"("artifactId","createdAt" DESC);

ALTER TABLE "Tag" ADD CONSTRAINT "Tag_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskTag" ADD CONSTRAINT "TaskTag_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskTag" ADD CONSTRAINT "TaskTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
