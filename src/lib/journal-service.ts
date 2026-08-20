import { Prisma, type JournalCandidateKind, type JournalRole } from "@prisma/client";
import { db } from "@/lib/db";
import type { TaskActor } from "@/lib/task-service";

const entryInclude = {
  contributions: {
    include: {
      projects: { include: { project: { select: { id: true, key: true, name: true } } } },
      revisions: { orderBy: { version: "desc" as const }, take: 10 }
    },
    orderBy: [{ importance: "desc" as const }, { createdAt: "asc" as const }]
  },
  candidates: {
    include: { project: { select: { id: true, key: true, name: true } } },
    orderBy: [{ consumedAt: "asc" as const }, { importance: "desc" as const }, { createdAt: "asc" as const }]
  },
  activities: { orderBy: { createdAt: "desc" as const }, take: 100 }
} satisfies Prisma.JournalEntryInclude;

export type JournalEntryWithContext = Prisma.JournalEntryGetPayload<{ include: typeof entryInclude }>;

export type JournalSearchResult = {
  kind: "CONTRIBUTION" | "CANDIDATE";
  passageId: string;
  entryId: string;
  entryDate: Date;
  entryTitle: string;
  authorKey: string;
  authorLabel: string;
  modelId: string | null;
  role: string;
  passage: string;
  importance: number;
  topics: string[];
  projectKeys: string[];
  rank: number;
};

export function parseJournalDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Journal date must use YYYY-MM-DD");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Journal date is invalid");
  }
  return date;
}

export function journalDateString(date: Date) {
  return date.toISOString().slice(0, 10);
}

function defaultJournalTitle(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", year: "numeric", month: "long", day: "numeric", weekday: "long"
  }).format(date);
}

async function ensureEntry(tx: Prisma.TransactionClient, workspaceId: string, entryDate: Date) {
  return tx.journalEntry.upsert({
    where: { workspaceId_entryDate: { workspaceId, entryDate } },
    create: { workspaceId, entryDate, title: defaultJournalTitle(entryDate) },
    update: {}
  });
}

async function validateProjects(tx: Prisma.TransactionClient, workspaceId: string, projectIds: string[]) {
  const uniqueIds = [...new Set(projectIds)];
  if (!uniqueIds.length) return uniqueIds;
  const count = await tx.project.count({ where: { workspaceId, id: { in: uniqueIds } } });
  if (count !== uniqueIds.length) throw new Error("Journal projects must belong to the same workspace");
  return uniqueIds;
}

export async function getJournalEntry(workspaceId: string, date: string) {
  return db.journalEntry.findUnique({
    where: { workspaceId_entryDate: { workspaceId, entryDate: parseJournalDate(date) } },
    include: entryInclude
  });
}

export async function upsertJournalContribution(
  input: {
    workspaceId: string;
    date: string;
    authorKey: string;
    authorLabel: string;
    modelId?: string | null;
    role?: JournalRole;
    bodyMarkdown: string;
    topics?: string[];
    importance?: number;
    sourceReferences?: Prisma.InputJsonValue;
    projectIds?: string[];
    candidateIds?: string[];
    version?: number;
  },
  actor: TaskActor
) {
  const entryDate = parseJournalDate(input.date);
  return db.$transaction(async (tx) => {
    const entry = await ensureEntry(tx, input.workspaceId, entryDate);
    if (entry.status === "FINALIZED") throw new Error("Finalized Journal entries cannot be changed");
    const projectIds = await validateProjects(tx, input.workspaceId, input.projectIds ?? []);
    const topics = [...new Set((input.topics ?? []).map((item) => item.trim()).filter(Boolean))];
    const existing = await tx.journalContribution.findUnique({
      where: { entryId_authorKey: { entryId: entry.id, authorKey: input.authorKey } }
    });
    if (existing && input.version !== existing.version) {
      throw new Error("Journal contribution changed since it was loaded");
    }
    if (!existing && input.version !== undefined) {
      throw new Error("Journal contribution does not exist at that version");
    }

    const common = {
      authorLabel: input.authorLabel,
      modelId: input.modelId ?? null,
      role: input.role ?? "REFLECTION" as JournalRole,
      bodyMarkdown: input.bodyMarkdown,
      topics,
      importance: input.importance ?? 3,
      sourceReferences: input.sourceReferences ?? Prisma.JsonNull
    };
    const contribution = existing
      ? await tx.journalContribution.update({
          where: { id: existing.id },
          data: { ...common, version: { increment: 1 } }
        })
      : await tx.journalContribution.create({
          data: { entryId: entry.id, authorKey: input.authorKey, ...common }
        });

    await tx.journalContributionProject.deleteMany({ where: { contributionId: contribution.id } });
    if (projectIds.length) {
      await tx.journalContributionProject.createMany({
        data: projectIds.map((projectId) => ({ contributionId: contribution.id, projectId }))
      });
    }
    await tx.journalContributionRevision.create({
      data: {
        contributionId: contribution.id,
        version: contribution.version,
        authorLabel: contribution.authorLabel,
        modelId: contribution.modelId,
        role: contribution.role,
        bodyMarkdown: contribution.bodyMarkdown,
        topics: contribution.topics,
        importance: contribution.importance,
        sourceReferences: contribution.sourceReferences ?? Prisma.JsonNull,
        createdBy: actor.label
      }
    });

    const candidateIds = [...new Set(input.candidateIds ?? [])];
    if (candidateIds.length) {
      const updated = await tx.journalCandidate.updateMany({
        where: { id: { in: candidateIds }, entryId: entry.id, consumedAt: null },
        data: { consumedAt: new Date() }
      });
      if (updated.count !== candidateIds.length) {
        throw new Error("Journal candidates must be unused events from the same day");
      }
    }
    const updatedEntry = await tx.journalEntry.update({
      where: { id: entry.id }, data: { version: { increment: 1 } }
    });
    await tx.activity.create({
      data: {
        workspaceId: input.workspaceId,
        journalEntryId: entry.id,
        journalContributionId: contribution.id,
        actorType: actor.type,
        actorLabel: actor.label,
        action: existing ? "journal.contribution_updated" : "journal.contribution_created",
        summary: `${existing ? "Updated" : "Added"} ${contribution.authorLabel}'s Journal contribution for ${input.date}`,
        metadata: {
          authorKey: contribution.authorKey,
          modelId: contribution.modelId,
          role: contribution.role,
          importance: contribution.importance,
          contributionVersion: contribution.version,
          entryVersion: updatedEntry.version,
          candidateIds
        }
      }
    });
    return tx.journalEntry.findUniqueOrThrow({ where: { id: entry.id }, include: entryInclude });
  });
}

export async function flagJournalCandidate(
  input: {
    workspaceId: string;
    date: string;
    authorKey: string;
    authorLabel: string;
    modelId?: string | null;
    kind: JournalCandidateKind;
    summary: string;
    contextMarkdown?: string | null;
    importance?: number;
    sourceReferences?: Prisma.InputJsonValue;
    projectId?: string | null;
  },
  actor: TaskActor
) {
  const entryDate = parseJournalDate(input.date);
  return db.$transaction(async (tx) => {
    const entry = await ensureEntry(tx, input.workspaceId, entryDate);
    if (entry.status === "FINALIZED") throw new Error("Finalized Journal entries cannot be changed");
    if (input.projectId) await validateProjects(tx, input.workspaceId, [input.projectId]);
    const candidate = await tx.journalCandidate.create({
      data: {
        entryId: entry.id,
        projectId: input.projectId ?? null,
        authorKey: input.authorKey,
        authorLabel: input.authorLabel,
        modelId: input.modelId ?? null,
        kind: input.kind,
        summary: input.summary,
        contextMarkdown: input.contextMarkdown ?? null,
        importance: input.importance ?? 3,
        sourceReferences: input.sourceReferences ?? Prisma.JsonNull
      }
    });
    const updatedEntry = await tx.journalEntry.update({
      where: { id: entry.id }, data: { version: { increment: 1 } }
    });
    await tx.activity.create({
      data: {
        workspaceId: input.workspaceId,
        projectId: input.projectId ?? null,
        journalEntryId: entry.id,
        journalCandidateId: candidate.id,
        actorType: actor.type,
        actorLabel: actor.label,
        action: "journal.candidate_flagged",
        summary: `Flagged ${candidate.kind.toLowerCase().replaceAll("_", " ")} for the ${input.date} Journal`,
        metadata: {
          authorKey: candidate.authorKey,
          modelId: candidate.modelId,
          importance: candidate.importance,
          entryVersion: updatedEntry.version
        }
      }
    });
    return tx.journalEntry.findUniqueOrThrow({ where: { id: entry.id }, include: entryInclude });
  });
}

export async function finalizeJournalEntry(id: string, version: number, actor: TaskActor) {
  return db.$transaction(async (tx) => {
    const current = await tx.journalEntry.findUniqueOrThrow({ where: { id } });
    if (current.status === "FINALIZED") throw new Error("Journal entry is already finalized");
    const updated = await tx.journalEntry.updateMany({
      where: { id, version, status: "OPEN" },
      data: {
        status: "FINALIZED",
        finalizedAt: new Date(),
        finalizedBy: actor.label,
        version: { increment: 1 }
      }
    });
    if (updated.count !== 1) throw new Error("Journal entry changed since it was loaded");
    const entry = await tx.journalEntry.findUniqueOrThrow({ where: { id } });
    await tx.activity.create({
      data: {
        workspaceId: entry.workspaceId,
        journalEntryId: entry.id,
        actorType: actor.type,
        actorLabel: actor.label,
        action: "journal.entry_finalized",
        summary: `Finalized Journal entry for ${journalDateString(entry.entryDate)}`,
        metadata: { version: entry.version }
      }
    });
    return tx.journalEntry.findUniqueOrThrow({ where: { id }, include: entryInclude });
  });
}

export async function getAgentReflections(
  workspaceId: string,
  authorKey: string,
  options: { before?: string; limit?: number } = {}
) {
  return db.journalContribution.findMany({
    where: {
      authorKey,
      entry: {
        workspaceId,
        entryDate: options.before ? { lt: parseJournalDate(options.before) } : undefined
      }
    },
    include: {
      entry: { select: { id: true, entryDate: true, title: true, status: true } },
      projects: { include: { project: { select: { id: true, key: true, name: true } } } }
    },
    orderBy: { entry: { entryDate: "desc" } },
    take: Math.min(Math.max(options.limit ?? 20, 1), 100)
  });
}

export async function searchJournal(
  workspaceId: string,
  input: {
    query: string;
    dateFrom?: string;
    dateTo?: string;
    authorKey?: string;
    topic?: string;
    projectId?: string;
    minImportance?: number;
    limit?: number;
  }
) {
  const from = input.dateFrom ? parseJournalDate(input.dateFrom) : undefined;
  const to = input.dateTo ? parseJournalDate(input.dateTo) : undefined;
  const contributionFilters: Prisma.Sql[] = [Prisma.sql`je."workspaceId" = CAST(${workspaceId} AS uuid)`];
  const candidateFilters: Prisma.Sql[] = [Prisma.sql`je."workspaceId" = CAST(${workspaceId} AS uuid)`];
  if (from) {
    contributionFilters.push(Prisma.sql`je."entryDate" >= ${from}`);
    candidateFilters.push(Prisma.sql`je."entryDate" >= ${from}`);
  }
  if (to) {
    contributionFilters.push(Prisma.sql`je."entryDate" <= ${to}`);
    candidateFilters.push(Prisma.sql`je."entryDate" <= ${to}`);
  }
  if (input.authorKey) {
    contributionFilters.push(Prisma.sql`jc."authorKey" = ${input.authorKey}`);
    candidateFilters.push(Prisma.sql`jca."authorKey" = ${input.authorKey}`);
  }
  if (input.topic) {
    contributionFilters.push(Prisma.sql`${input.topic} = ANY(jc."topics")`);
    candidateFilters.push(Prisma.sql`FALSE`);
  }
  if (input.minImportance) {
    contributionFilters.push(Prisma.sql`jc."importance" >= ${input.minImportance}`);
    candidateFilters.push(Prisma.sql`jca."importance" >= ${input.minImportance}`);
  }
  if (input.projectId) {
    contributionFilters.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "JournalContributionProject" jcp
      WHERE jcp."contributionId" = jc."id" AND jcp."projectId" = CAST(${input.projectId} AS uuid)
    )`);
    candidateFilters.push(Prisma.sql`jca."projectId" = CAST(${input.projectId} AS uuid)`);
  }
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  return db.$queryRaw<JournalSearchResult[]>(Prisma.sql`
    WITH q AS (SELECT websearch_to_tsquery('english', ${input.query}) AS value), matches AS (
      SELECT
        'CONTRIBUTION'::text AS "kind",
        jc."id" AS "passageId",
        je."id" AS "entryId",
        je."entryDate" AS "entryDate",
        je."title" AS "entryTitle",
        jc."authorKey" AS "authorKey",
        jc."authorLabel" AS "authorLabel",
        jc."modelId" AS "modelId",
        jc."role"::text AS "role",
        jc."bodyMarkdown" AS "passage",
        jc."importance" AS "importance",
        jc."topics" AS "topics",
        ARRAY(SELECT p."key" FROM "JournalContributionProject" jcp JOIN "Project" p ON p."id" = jcp."projectId" WHERE jcp."contributionId" = jc."id" ORDER BY p."key") AS "projectKeys",
        ts_rank_cd(to_tsvector('english', coalesce(jc."bodyMarkdown", '') || ' ' || coalesce(jc."authorLabel", '')), q.value)::float8 AS "rank"
      FROM "JournalContribution" jc
      JOIN "JournalEntry" je ON je."id" = jc."entryId"
      CROSS JOIN q
      WHERE ${Prisma.join(contributionFilters, " AND ")}
        AND to_tsvector('english', coalesce(jc."bodyMarkdown", '') || ' ' || coalesce(jc."authorLabel", '')) @@ q.value
      UNION ALL
      SELECT
        'CANDIDATE'::text AS "kind",
        jca."id" AS "passageId",
        je."id" AS "entryId",
        je."entryDate" AS "entryDate",
        je."title" AS "entryTitle",
        jca."authorKey" AS "authorKey",
        jca."authorLabel" AS "authorLabel",
        jca."modelId" AS "modelId",
        jca."kind"::text AS "role",
        concat_ws(E'\n\n', jca."summary", jca."contextMarkdown") AS "passage",
        jca."importance" AS "importance",
        ARRAY[]::text[] AS "topics",
        CASE WHEN p."key" IS NULL THEN ARRAY[]::text[] ELSE ARRAY[p."key"] END AS "projectKeys",
        ts_rank_cd(to_tsvector('english', coalesce(jca."summary", '') || ' ' || coalesce(jca."contextMarkdown", '')), q.value)::float8 AS "rank"
      FROM "JournalCandidate" jca
      JOIN "JournalEntry" je ON je."id" = jca."entryId"
      LEFT JOIN "Project" p ON p."id" = jca."projectId"
      CROSS JOIN q
      WHERE ${Prisma.join(candidateFilters, " AND ")}
        AND to_tsvector('english', coalesce(jca."summary", '') || ' ' || coalesce(jca."contextMarkdown", '')) @@ q.value
    )
    SELECT * FROM matches ORDER BY "rank" DESC, "entryDate" DESC LIMIT ${limit}
  `);
}

export function renderJournalMarkdown(entry: JournalEntryWithContext) {
  const lines = [
    `# ${entry.title}`,
    ...(entry.subtitle ? ["", entry.subtitle] : []),
    "",
    `<!-- journal-entry id=${entry.id} date=${journalDateString(entry.entryDate)} status=${entry.status.toLowerCase()} version=${entry.version} -->`
  ];
  for (const contribution of entry.contributions) {
    const projects = contribution.projects.map(({ project }) => project.key).join(",");
    lines.push(
      "",
      `## ${contribution.authorLabel}`,
      "",
      `<!-- journal-section id=${contribution.id} author=${contribution.authorKey} model=${contribution.modelId ?? "unknown"} role=${contribution.role.toLowerCase()} importance=${contribution.importance} topics=${contribution.topics.join(",")} projects=${projects} -->`,
      "",
      contribution.bodyMarkdown.trim()
    );
  }
  return `${lines.join("\n").trim()}\n`;
}
