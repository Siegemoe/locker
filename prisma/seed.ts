import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const user = await db.user.upsert({
    where: { externalId: "local-user" },
    update: {},
    create: { externalId: "local-user", displayName: "Local user" }
  });
  const workspace = await db.workspace.upsert({
    where: { slug: "spore-locker" },
    update: {},
    create: {
      slug: "spore-locker",
      name: "Spore Locker",
      description: "Local-first task and project workspace"
    }
  });
  await db.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
    update: { role: "OWNER" },
    create: { workspaceId: workspace.id, userId: user.id, role: "OWNER" }
  });
  const project = await db.project.upsert({
    where: { workspaceId_key: { workspaceId: workspace.id, key: "SPORE" } },
    update: {},
    create: {
      workspaceId: workspace.id,
      key: "SPORE",
      name: "Spore Locker",
      description: "Build the local-first Codex workspace",
      color: "#a3e635"
    }
  });
  const tagDefaults = [
    ["Feature", "#7fb069"], ["Bug", "#d96c5f"], ["MVP Idea", "#d4a84f"],
    ["UI/UX", "#9b78d1"], ["Security", "#d98f48"], ["MCP", "#5f9fd6"]
  ] as const;
  for (const [name, color] of tagDefaults) {
    const existing = await db.tag.findUnique({ where: { workspaceId_name: { workspaceId: workspace.id, name } } });
    if (!existing) {
      const tag = await db.tag.create({ data: { workspaceId: workspace.id, name, color } });
      await db.activity.create({
        data: {
          workspaceId: workspace.id, tagId: tag.id, actorType: "SYSTEM", actorLabel: "Spore Locker seed",
          action: "tag.created", summary: `Created default tag: ${name}`
        }
      });
    }
  }
  if ((await db.task.count({ where: { workspaceId: workspace.id } })) === 0) {
    await db.task.createMany({
      data: [
        { workspaceId: workspace.id, projectId: project.id, title: "Connect desktop host identity", status: "BLOCKED", priority: "HIGH", position: 0, createdBy: "Seed" },
        { workspaceId: workspace.id, projectId: project.id, title: "Review the local task API", status: "READY", priority: "MEDIUM", position: 1, createdBy: "Seed" },
        { workspaceId: workspace.id, projectId: project.id, title: "Run the first local migration", status: "DONE", priority: "MEDIUM", position: 2, completedAt: new Date(), createdBy: "Seed" }
      ]
    });
  }
  console.log({ workspaceId: workspace.id, projectId: project.id });
}

main().finally(() => db.$disconnect());
